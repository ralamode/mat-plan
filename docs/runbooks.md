# Runbooks — manual operational procedures

Step-by-step for the **manual** operations that aren't (or can't be) fully automated. Each entry:
**when** to use it · **why** it's manual · the **steps** · **safety** (idempotency / blast radius).

Prefer automation where it exists (e.g. reference-data now deploy-seeds via `migrate.yml` on every push
to `main`). A runbook here is for the genuinely-manual or break-glass cases. When a manual step recurs,
consider promoting it to a script or CI job and replacing the entry with a pointer.

> Anything touching **prod data** or **secrets**: double-check you're on the **production** Neon
> branch/database (not a dev branch), and prefer an **idempotent, guarded** statement so a re-run is a
> no-op.

---

## Correct wrong data in prod (`db:correct`)

**When:** data is wrong in a way **the app cannot fix**. That is not hypothetical — there is no delete
action anywhere in the app, and several shapes are deliberately not editable (a bodyweight set, a
labelled set, a non-`done` set), so a mis-tap can be genuinely unrecoverable through the UI.

```bash
pnpm --filter @mat-plan/db db:correct                      # list what exists
pnpm --filter @mat-plan/db db:correct <name>               # DRY RUN — prints, writes nothing
pnpm --filter @mat-plan/db db:correct <name> --apply       # writes
```

**Dry run is the default and `--apply` is the only thing that writes.** The script prints the target
host before doing anything, so a prod correction is never run against local by accident.

Set `DATABASE_URL_UNPOOLED` to the target database (the direct string, like migrate — a correction is
ops work, not app traffic).

**Every correction is guarded and idempotent**: the `WHERE` includes the value being corrected _from_,
so a second run matches nothing and reports `0`. Re-running after a partial failure is safe.

**A correction treats the data; the bug still needs a PR.** Each one names the backlog row that fixes
the cause. Adding one is a single entry in
[`packages/db/scripts/corrections/registry.ts`](../packages/db/scripts/corrections/registry.ts) — see
the [README](../packages/db/scripts/corrections/README.md) for the rules.

**A correction merges before it runs, and `--apply` is manual — so mind what is queued behind it.**
`bodyweight-duplicates-2026-09-30` (V1-24 PR 1c) clears the duplicate weigh-ins that **PR 1d's
`CREATE UNIQUE INDEX` cannot tolerate**, and the order is not optional:

0. **dry run** — check the printed `target:` host is prod, and read the diff (the keeper's value
   prints on its own line; never paste it anywhere — this repo is public);
1. `--apply` the correction;
2. **re-run it** — it must print 0 changes (it also refuses unless the day holds exactly one live
   weight, so this is the proof, not a formality);
3. **re-run the duplicate query** (the literal SQL is committed in
   [the plan](./plans/v1-24-form-is-the-day.md) → "File-by-file — PR 1c"), because any render made
   before another device saved can still create a duplicate until 1d's index is applied;
4. date the correction's **Applied** cell in
   [the corrections README](../packages/db/scripts/corrections/README.md) (`pending` → the date);
5. merge 1d. ✅ Steps 0–4 done 2026-10-01 (#206); **re-run step 3 just before merging 1d**.

**Rollback** needs no restore branch — this is a soft delete. Before 1d lands, undo is
`UPDATE entries SET deleted_at = NULL, updated_at = now() WHERE public_id IN (<the two losers>) AND
deleted_at IS NOT NULL;` (the original `updated_at` tokens are gone, so key on `public_id`). After an un-delete the
correction refuses those rows as drifted — expected: their `updated_at` is now `now()`, so re-reading
is the next step. After 1d lands, un-deleting a row would violate its index.

**Before chunk 2 of V1-22 (the snapshot writer) merges, `0013` must be live in prod.** Same shape as
1e below, and the same "check both": `gh run list --workflow migrate.yml --branch main -L 3` shows
**success on chunk 1's merge SHA** — the run being green is not enough on its own, because the migrate
step `exit 0`ed with a warning when its secret was absent (before `OPS-2` PR 1) — **and** in prod

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'entries_prescribed_snapshot_movement_check';
```

returns the predicate in `packages/db/migrations/0013_prescribed_snapshot.sql`, **and**
`prescribed_snapshot` appears in `information_schema.columns`. Until all three hold, chunk 2's code
names a column that may not exist, on the strength write.

## Before chunk 1c of AUTH-1

🔴 **1c is the one-way door**: the session becomes the boundary, and a maintainer who cannot resolve a
household is locked out of their own data. Two things must be true first, and **neither is proved by a
green CI run**.

### 1. `0019` is live in prod — three checks, not one

Same shape and the same "check all three" as `0013` above. ⚠️ `gh run list` being green is **not**
sufficient on its own: the migrate step `exit 0`ed with a warning (before `OPS-2` PR 1) when its secret was
absent, so a green run can mean **nothing was applied**.

1. `gh run list --workflow migrate.yml --branch main -L 3` shows **success on 1b's merge SHA**.
2. In prod, the table exists:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_name = 'household_members';
   ```
3. In prod, **both** constraints match `packages/db/migrations/0019_auth1b_household_members.sql`
   byte for byte — the CHECK and the partial unique, because 1c's resolver leans on the second one and
   a table without it would accept two live memberships for one account:
   ```sql
   SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'household_members_role_check';
   SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_household_members_clerk_user';
   ```

### 2. The claim correction has been run with `--apply`

🔴 **Read the Clerk user id from the PRODUCTION instance's dashboard, never the development one.**
Clerk instances are **separate user pools** — a `user_…` minted in development is **not** the id
production issues for the same Google account. Writing a development id into production's
`household_members` binds the household to an id that will never sign in, and 1c then lands the
maintainer in **state C**: signed in, no membership, locked out of their own household by the chunk
whose job was to bind them to it. The correction asserts the id is _Clerk-shaped_; **it cannot tell
development from production.** This check is yours.

So, in order:

1. **Create the production instance** and finish the dashboard half of the AUTH-1 checklist below.
2. **Sign in once against production**, so an account exists there.
3. **Read that instance's `user_…`** from the Clerk dashboard → Users.
4. **Dry run first.** Targets come from the environment, never a flag and never a committed constant —
   a command line is broadly visible via `ps`, and this id is personal data in a public repo:
   ```bash
   HOUSEHOLD_PUBLIC_ID=<the household's public_id> CLERK_USER_ID=user_… \
     DATABASE_URL_UNPOOLED=<prod, unpooled> \
     pnpm --filter @mat-plan/db db:correct household-claim-2026-10-25
   ```
   It writes nothing and prints the **full** id, so check it against the dashboard before continuing.
5. **Re-run with `--apply`.** A second `--apply` is an idempotent no-op; pointing the same Clerk id at a
   _different_ household **refuses** rather than moving it.
6. **Confirm**, in prod:
   ```sql
   SELECT role, created_at FROM household_members WHERE deleted_at IS NULL;
   ```
   Exactly one live row, `role = 'owner'`.

⚠️ **Do not paste the Clerk user id into a PR, an issue, or a commit.** It is a stable third-party
account identifier for a named adult (`docs/privacy/data-inventory.md` § 1a), and this repo is public.
The `Applied` table in `packages/db/scripts/corrections/README.md` records **neither** target, for the
same reason.

### 3. Sign out works against a real instance — the one control no harness can see

🔴 **Nothing automated covers this, by construction, and the code says so in two places.** Both
harnesses blank the Clerk keys on purpose (`e2e-local.ts`, `screenshot-ephemeral.ts`), so
`clerkIsConfigured()` is false, no `<ClerkProvider>` renders, and Playwright and axe only ever see
`SignOutPlaceholder`. What actually clears the session cookies is `@clerk/clerk-js`, fetched from a
CDN at a **floating major** and absent from `pnpm-lock.yaml` — so `sign-out.test.tsx` can only assert
what **our** file does **not** do (it names no cookie). This box is the positive half.

Against the **development** instance, signed in:

1. Press **Sign out** on `/p`.
2. Devtools → Application → Cookies: `__session` and `__client_uat` are **gone**.
3. 🔴 **`mp_gate` is STILL THERE.** This is the invariant, not a detail: sign-out clears the Clerk
   session **only** — and since `AUTH-1` 1d there is nothing else to clear. ⚠️ Historically, clearing
   the gate cookie too would have bounced the user to `/gate` needing the shared
   household code to re-enter **their own household** — and after `1c-4` that reader is an invited
   parent who does not have it. A button labelled "Sign out" that does that is a permanent lockout.
4. Navigate to `/p`: it redirects to `/sign-in`.
5. Sign in again: you land back on the picker. ⚠️ Said "without re-entering the access code" until
   `AUTH-1` 1d; signing in is now the only step there is.

If step 3 fails, **stop** — the control is a lockout and must not reach anyone outside the
maintainer's own browser.

### 4. `pnpm dev` needs its own membership row, and nothing gives it one

🔴 **From `AUTH-1` 1c-4 a local dev session lands in state C**, and the fixture row the test
harnesses write does **not** help: `dev-local.ts` deliberately injects no bypass principal, so you
sign in with a **real** dev-instance Google account, and that Clerk id has no `household_members`
row in your persistent sandbox.

This is not an oversight — see `embedded-pg.ts` → `linkFixtureMember`. Binding the fixture principal
into a long-lived sandbox is wrong on its own, and the correction refuses a second identical bind, so
the **second** `pnpm dev` would die before `next dev` started.

🔴 **The fixture guard does NOT cover this.** `fixtureBindIsAllowed` refuses only the committed e2e
principal; your real dev id passes it, so **the `target:` line the runner prints is the only control**
— which is why the dry run below is step 1 and not a footnote. A stale production
`DATABASE_URL_UNPOOLED` in the shell is the realistic way this goes wrong, and
`corrections/registry.ts` records the consequence from the other side: claiming production with a dev
id is what locks the maintainer out of their own household.

**1. Dry run, and read the `target:` host.** The household id is the value of
`SEED_HOUSEHOLD_PUBLIC_ID` (`packages/shared/src/seed-ids.ts`); the Clerk id comes from the
**development** instance's dashboard, never production's.

```bash
HOUSEHOLD_PUBLIC_ID=<SEED_HOUSEHOLD_PUBLIC_ID> \
  CLERK_USER_ID=user_<your dev instance id> \
  DATABASE_URL_UNPOOLED=postgres://…localhost… \
  pnpm --filter @mat-plan/db db:correct household-claim-2026-10-25
```

**2. If `target:` is your local sandbox, re-run with `--apply`.** A second run is an idempotent
no-op (`already claimed … — no change`), so this is safe to repeat.

### If something is wrong afterwards

A membership is soft-deletable and the partial unique is on `clerk_user_id WHERE deleted_at IS NULL`,
so clearing a mistake **frees the slot** and the correction can be re-run with the right id:

```sql
UPDATE household_members SET deleted_at = now(), updated_at = now()
 WHERE clerk_user_id = 'user_…' AND deleted_at IS NULL;
```

`db:verify` proves that freed-slot behaviour, so this is a tested path rather than a hopeful one.
⚠️ The soft-deleted row **keeps the identifier indefinitely** (§ 5 of the data inventory) — the
household deletion is its only purge.

**The wedge below applies to ANY pending migration, `0013` included** — a failed run re-fails on every
later push and takes `db:seed` with it, and the `lock_timeout` carve-out is the same.

**1e (the create path's arbiter) merges only after 1d's index is live in prod.** Check both, don't
assume:

- `gh run list --workflow migrate.yml --branch main -L 3` shows **success** on 1d's merge SHA;
- in prod, `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_entries_profile_day_bodyweight';`
  returns exactly the `CREATE UNIQUE INDEX` line in `packages/db/migrations/0012_bodyweight_one_per_day.sql`
  (same key, same `WHERE`). `indisvalid` needs no check: the index is built inside a transaction, not
  `CONCURRENTLY`.

1e's target-less `ON CONFLICT DO NOTHING` names no
index, so it cannot fail inference even if the index is missing — the gate is about meaning, not
breakage: without the index nothing refuses a second same-day row, and 1e's "already logged" answer
never fires.

**If 1d's migration refuses** (it merged before the data was clean, or a new duplicate appeared before
1d's index existed — the error names this section: _"V1-24 1d: N (profile, day, slot) group(s) hold
more than one live weigh-in"_), `migrate.yml` — which runs on **every** push to `main`, with no path filter and
no gate — fails the index build, and then **re-fails on every later push**, taking the `db:seed` step
and any other pending migration with it. Recovery is a correction for the new duplicates, `--apply`,
then re-running `migrate.yml` via `workflow_dispatch`. Bodyweight logging keeps working (nothing in the
app depends on the index existing — before 1e the arbiter is `client_id`, after it the arbiter is
target-less), but **any later PR that needs a migration or a seed row is broken in prod until the
wedge clears — freeze merges to `main` until then.**

- **The correction PR is the one exception to the freeze.** A correction must be on `main` before it can
  `--apply`, so it merges while migrate is wedged — and that merge's own `migrate.yml` run **fails too,
  as expected** (the duplicates are still there until you `--apply`). Don't chase that red run: apply,
  then `workflow_dispatch`.
- **A `lock_timeout` failure is not this.** If the run fails with `canceling statement due to lock
timeout` (the migration waits at most 5 s for `entries` — e.g. behind a long transaction) rather than
  the pre-check's message above, nothing is wrong with the data: re-run `migrate.yml` via
  `workflow_dispatch`, and the freeze is the same until it goes green.

**If 3b-0's migration refuses** (V1-24 3b-0, one live practice per athlete and day; the error names
this section: _"V1-24 3b-0: N (profile, day) group(s) hold more than one live practice"_), it is the
same wedge as 1d's above, with the same freeze and the same exceptions. What differs:

- **A group may be two real sessions, not a duplicate.** `practice_minutes` sums, so two rows on one
  day may be a morning and an evening practice. Read the groups (aggregate first, inside
  `BEGIN READ ONLY`, the query in [the plan](./plans/v1-24-3b-logs-in-place.md) → Z3), and the
  maintainer decides each: **merge** (one row holds the day's total) or **hide** the duplicate. No
  practice correction exists yet; write one in `corrections/registry.ts`, guarded and dry-run first
  (the `data-correction` skill), and never commit a profile, a date or a value.
- **The app keeps logging meanwhile.** The new writer's insert is target-less and names no index, so
  it works with or without it; until the index exists, nothing refuses a second same-day practice.
- **Reading the groups.** Z3's query returns only a count. To decide each group, list its sizes and
  minutes without naming anyone: `SELECT count(*), array_agg(value_num) FROM entries WHERE deleted_at
IS NULL AND metric_key = 'practice_minutes' GROUP BY profile_id, activity_date HAVING count(*) > 1;`
  inside `BEGIN READ ONLY`. Read the profile and the date only on the operator's screen, never into a
  file, a PR or a chat.
- **The preview database refuses too** if it holds a duplicate (`migrate-preview.yml` runs the same
  file). Seed-only data needs no correction: "Standing: reset the preview database" below clears it.
  After a clean apply, an open branch that has not merged main still runs the old `client_id`-target
  writer against the shared preview database, so a second same-day practice there is an error page
  until that branch merges main.

**3b-life merges only after 3b-0's index is live in prod.** Check both, as for 1e above:

- `gh run list --workflow migrate.yml --branch main -L 3` shows **success** on 3b-0's merge SHA;
- in prod, `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_entries_profile_day_practice';`
  returns the `CREATE UNIQUE INDEX` line of the `_v1_24_3b0_practice_one_per_day.sql` migration.

A Vercel rollback past 3b-0 puts the old `client_id`-target writer back against the index, so a
second same-day practice becomes an error page until the rollback is undone.

---

## Enable `pg_stat_statements` on prod (slow-query insight) — do this ONCE

[ADR 0001](./decisions/0001-observability-and-web-vitals.md) § 4 asks for it and its phasing table
says "with real data (V1)". Prod has real data, so it is due.

🔴 **This is an OPERATOR action, NOT a migration, and the reason is measured.** Every migration is
replayed by `db:verify` on **PGlite**, which does not ship the extension:

```
CREATE EXTENSION IF NOT EXISTS pg_stat_statements
  →  ERROR: extension "pg_stat_statements" is not available
SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements'
  →  0 rows
```

(probed on `@electric-sql/pglite@0.5.13`, 2026-11-06). So a migration carrying `CREATE EXTENSION`
turns `db:verify` red on **every PR afterwards**, not just its own. It is also not schema the app
depends on: nothing in `packages/db` or `apps/web` reads `pg_stat_statements`, so there is nothing for
a migration to keep in sync. ⚠️ **Do not "fix" a red `db:verify` by guarding the statement** — the
guard would make the extension silently absent in prod too, which is the failure this note exists to
prevent.

**The steps.** Run against the **direct/unpooled** string (`DATABASE_URL_UNPOOLED`), not the pooled
one — PgBouncer in transaction mode is the wrong place for a session-scoped `CREATE EXTENSION`.

1. Neon preloads the library on every project, so no console change is needed first. Confirm:

   ```sql
   SELECT name, default_version, installed_version
   FROM pg_available_extensions WHERE name = 'pg_stat_statements';
   ```

   An empty result means it is **not** preloaded on this plan — stop and set it in the Neon console
   (Settings → Postgres parameters → `shared_preload_libraries`), which needs a compute restart.

2. Create it:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```

3. Verify it is installed, not merely available:

   ```sql
   SELECT installed_version FROM pg_available_extensions WHERE name = 'pg_stat_statements';
   SELECT count(*) FROM pg_stat_statements;   -- a number, not an error
   ```

4. **Read it a week later, not immediately** — it accumulates from creation, so a reading taken the
   same minute says nothing. The query worth keeping:

   ```sql
   SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms,
          round(total_exec_time::numeric) AS total_ms, left(query, 90) AS q
   FROM pg_stat_statements
   WHERE query NOT LIKE '%pg_stat_statements%'
   ORDER BY total_exec_time DESC LIMIT 15;
   ```

   ⚠️ **`query` is normalised but not guaranteed free of personal data** — a literal that was not
   parameterised appears verbatim. This app's writes go through Drizzle with bound parameters, so in
   practice the text is shape-only, but **never paste the output of this query into the repo, a PR or
   an issue** without reading it first (AGENTS.md → Privacy; the repo is public and holds minors'
   data). `left(query, 90)` is in the query above for that reason, not for width.

**Cost and reversibility.** Tracks a bounded number of statement shapes
(`pg_stat_statements.max`, default 5000) in shared memory; the overhead is a few percent on very
high-throughput systems and unmeasurable at this app's few-rows-per-athlete-per-day. Reversible with
`DROP EXTENSION pg_stat_statements;` — and `SELECT pg_stat_statements_reset();` zeroes the counters
without dropping it, which is what you want before measuring a specific change.

**What this does NOT give you.** It is cumulative server-side timing, so it finds a slow query; it
cannot tell you a page got slower for a person on a phone. That is Core Web Vitals, and it is blocked
behind the `connect-src` decision in [OBS-1](./plan.md#obs-1).

## The runtime statement timeout (`SCALE-3`)

**When:** after the `SCALE-3` migration merges; after any restore from a Neon branch cut before it;
or when a manual query fails with `57014 canceling statement due to statement timeout`.

**Why it is manual:** the timeout is a default on the database role, applied only when a backend
starts, so no gate can watch pooled traffic pick it up ([plan](./plans/scale-3-statement-timeout.md)).

1. **The app's role carries it.** On the **pooled** string (the one Vercel's `DATABASE_URL` holds, so
   this reads the app's role, not the migrator's):
   `SELECT current_user, rolconfig FROM pg_roles WHERE rolname = current_user;` must include
   `statement_timeout=15s`. It reads the catalog, so the age of the backend does not matter.
2. **No backend predates it.** On the direct string, with `<t>` the time `migrate.yml`'s "Apply
   migrations" step **finished** (later is safe; the run's start time would miss a backend opened during
   setup), `0` from this means every live backend is bounded (read-only; re-run later if not):
   `SELECT count(*) FROM pg_stat_activity WHERE usename = current_user AND backend_start < '<t>';`
3. **A long manual query of your own:** `BEGIN; SET LOCAL statement_timeout = 0; <query>; COMMIT;`.
   It lasts for that transaction only, on either string, and never reaches a backend the app reuses.
4. **Emergency: the timeout is cancelling legitimate traffic.** On the direct string,
   `ALTER ROLE CURRENT_USER RESET statement_timeout;` (it, too, reaches only new backends), then a
   forward migration that does the same, so `db:verify` and production agree again.

**Safety:** steps 1–3 are read-only or transaction-scoped. Step 4 writes one catalog row.

**Last run on production** (the maintainer, 2026-11-17, after migration `0028` applied at
2026-11-16T22:59:40Z):

- [x] Step 1: `current_user` is `neondb_owner` and `rolconfig` is `{statement_timeout=15s}`. The
      pooled string uses the same role as the migrator, so the default reaches the app.
- [x] Step 2: `0` backends started before 22:59:40Z, so every live backend is bounded.

## A pending migration wedges prod and the seed with it

**When:** a `migrate.yml` run failed and left a migration **pending**. Promoted to its own heading at
`TEN-2a` because the migration headers that send an operator here (`0012`, `0014`, `0015`) were
pointing at prose buried inside the `db:correct` entry above, and the two other headings nearby are
still `_TODO_` stubs. **This applies to ANY pending migration**, whatever made it fail.

**Why it is manual:** `migrate.yml` runs on **every** push to `main`, with no path filter and no gate,
and `db:seed` runs in the **same job** immediately after `db:migrate`. So a failed migration:

1. **re-fails on every later push**, because the pending file is retried first;
2. **takes `db:seed` down with it**, so no new reference-data row reaches prod either;
3. leaves **no partial state** — drizzle wraps the whole pending set in one transaction, so nothing
   half-applied needs undoing.

**Steps.**

1. Read the failing step's log and decide which of the two it is. A **data** refusal (a migration's own
   `DO $$` pre-check raising, a constraint rejecting existing rows) means the data must be corrected
   first — use the `db:correct` entry above. A **`lock_timeout` / `statement_timeout`** failure
   (`canceling statement due to lock timeout`, SQLSTATE `55P03`) means nothing is wrong with the data:
   the DDL waited out its `lock_timeout` (the migration's header gives it) behind someone else's transaction.
2. **Freeze merges to `main` until the wedge clears.** Any later PR that needs a migration or a seed
   row is broken in prod until then. The **one exception** is a correction PR: a correction must be on
   `main` before it can `--apply`, so it merges while migrate is wedged, and that merge's own
   `migrate.yml` run **fails too, as expected**. Don't chase that red run.
3. Fix the cause — `--apply` the correction, or simply wait out the lock.
4. **Re-run `migrate.yml` via `workflow_dispatch`** (see "Manually re-seed / re-apply prod" below) and
   confirm it is green on the current `main` SHA: `gh run list --workflow migrate.yml --branch main -L 3`.
   ⚠️ A green run is not sufficient on its own: before `OPS-2` PR 1 the migrate step `exit 0`ed with a
   warning when its secret was absent (since then it fails). Confirm in prod that the thing the migration adds is actually
   there (`information_schema.columns`, `pg_indexes`, `pg_constraint`).

**Safety.** Nothing here is destructive. The app keeps serving: a pending migration means prod simply
does not yet have the new column/index, which is why most migrations in this repo ship additive and
dark ahead of their reader. ⚠️ **Not all of them, since FAM-1:** its migrations land in the same PR
as the `schema.ts` change, and Drizzle names every column on insert, so between the deploy and the
migration an insert into the changed table fails `42703` (the FAM-1 plan §3 accepts this window;
each step's migration header names the statements). The recovery is this re-run; FAM-1 merges
migrations when nobody is logging. 0022: every movement resolved by name (a strength save with a
typed name, existing or new) and every `insert into movements` (a new item, the seed). 0024: EVERY
insert into `sessions`, `supersets` or `entries`, so all logging; meanwhile roll Vercel back to the
previous deployment (its code works on either schema), then re-run as below. 0025: no request-path
statement (the only insert into `prescriptions` is the fixtures seed, and nothing reads or writes
`prescription_quantities`), so the app keeps serving; re-run as below. 0030 (V1-9b B2-0): as 0024,
EVERY insert into `entries` and every hide and restore, so all logging; roll Vercel back, then re-run. 0031 (lane A's VALIDATE): no request-path statement (it only scans), so the app keeps serving; a `23514` names the constraint and table, never the row (the read in [its plan](./plans/tdebt-validate-name-and-nan-checks.md) finds it), and its correction must repair the value, since a soft delete of that row is refused too; then re-run as below. 0032 (CAT-3 A1): EVERY insert into `movements` (a new item, the seed) fails `42703`; reads are unaffected and nothing reads the new tables. Roll Vercel back (old code runs on either schema) and re-dispatch `migrate.yml` at once: merges are frozen (step 2), so do not wait for a later push to retry it. A failed insert's parameters carry `movements.name`, a household's free text, so keep them out of anything shared.
⚠️ **Once B2 has shipped, never roll Vercel back past B2-0's deploy:** older code un-hides without
clearing `hide_reason`, which the CHECK refuses (`23514`) on any row Clear this day hid. ⚠️ Once the migration is
observed applied, **promote the latest deployment again**: as Vercel documents it, a rollback stops
production from following new deployments automatically, so later merges would not go live (unverified
here; check the Vercel dashboard after a rollback). 🔴 **The window was a privacy condition until `V1-9b` B1-2:** a
failed insert's `DrizzleQueryError` carries its `params` (a weigh-in, a note, how a session felt),
which Sentry's scrubber strips but Next's `console.error` writes to Vercel's runtime logs, kept 24
hours. Every DAL write and the scope read now rethrow through `lib/dal/quiet-db-errors.ts`, so a
failure in the window logs the operation, the error's type and the SQLSTATE, and at most ids and a
day from a read. If a deploy predates B1-2, or a write failed outside the DAL, record it in the
deletion ledger's incident notes (`docs/privacy/data-inventory.md` §7) rather than assume the logs
are clean.

---

## The seed's shadow guard fired (a WARNING since `TEN-2c` — it no longer refuses)

**When:** a `migrate.yml` run is **green** and its `db:seed` step logs
`seed: N household-owned movement(s) share a legacy seed slug and M share a library slug …` (since
`CAT-3` A2-i, 2026-11-19; before that, `seed: N seeded movement slug(s) are ALSO owned by a household …`). Added at `TEN-2b` as a **throw**;
**demoted to a warning at `TEN-2c`** (2026-10-12), when migration `0017` removed the premise it was
built on. ⚠️ **If a run went RED on that message, it is running a deploy older than `TEN-2c`** — the
refusal and its recovery are at the end of this section.

**What it means.** A household owns a `movements` row whose slug the seed also adds to the **global**
catalog, and **both rows now exist, legally.** With only the partial `uq_movements_slug_global` left
as the arbiter, a household-owned row sits **outside** that index's subset, so the global insert does
not collide with it and the curated row lands. Global-first then serves the **curated** row to
everyone, so that household's own row is **permanently shadowed** — the intended end state, but not an
obvious one, which is why it is still said out loud.

**What it is NOT.** Not an error, not a pending migration, and — the part that changed — **not a
missing catalog row**: the curated row **is** inserted. Nothing is wedged, nothing is lost, and
nothing has to be done today. `TEN-2c-1` (the split backfill) and `TEN-2b-2` (the orphan correction)
are the backlog rows that tidy a shadowed row up.

🔴 **Why the demotion had to be BOTH halves.** Until `TEN-2c` the guard was detect → **omit** → seed
→ **throw**, and the omission (a `seedableMovements` filter) ran **before** the arbiter was ever
consulted. Demoting only the `throw` would have left the curated row never inserted, forever, with
nothing complaining loudly — a loud confidentiality guard turned into a silent, permanent gap in
reference data, which is strictly worse than what it replaced. So the filter is **gone** and the
`throw` is a `console.warn`: `packages/db/src/seed.ts` → the long note above the `movements` insert.

**To see which rows, run this from your own console** (never in a workflow step, whose log is public):

```sql
-- Slugs and counts only. Never select `name` or a household's `public_id`: a row's name is a
-- household's free text, and this output must never be pasted into a PR, issue, plan, changelog
-- fragment or commit. Soft-deleted rows are included, as the seed's count includes them.
SELECT m.slug, count(*) AS household_rows
FROM movements m
WHERE m.household_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM movements g WHERE g.household_id IS NULL AND g.slug = m.slug)
GROUP BY m.slug
ORDER BY m.slug;
```

**If you want the shadowed row gone anyway — adopt or rename, never null.** Pick one, per slug the
query lists:

1. **The household's row is the real one** (someone typed a movement the catalog later added): the
   household row and the curated row must be merged. That is `TEN-2c-1`'s split machinery in reverse —
   repoint that household's `entries.movement_id` / `prescriptions.movement_id` to the curated row,
   then delete the household row. Needs a guarded, dry-run-first correction
   (`packages/db/scripts/corrections/`), not a hand-typed `UPDATE`. 🔴 **The correction takes the slug
   from the environment** (as `household-claim-2026-10-25` takes its targets), never as a committed
   constant: a slug a household holds says what they typed, and `git log -S` keeps it after any removal.
2. **The seed row is the mistake** (the slug should not have been added globally): revert the
   `MOVEMENT_SEED_ROWS` entry in its own PR. The seed then stops adding it and the warning stops.

⛔ **Never `UPDATE movements SET household_id = NULL`** on the household's row to clear the shadowing:
that promotes one household's free text into the global reference namespace, which is the defect
`ON DELETE NO ACTION` exists to prevent (`packages/db/src/schema.ts` → the `movements` docblock).

⚠️ **The message is published, and a warning is published exactly as widely as the refusal was.**
`migrate.yml` logs are world-readable on a public repo, so since `CAT-3` A2-i the message is **counts
only**: no slug (a slug a household also holds says what they typed) and never a row's `name`.
`db:verify` asserts both against everything printed to stdout and stderr; keep that property if you
extend it, because the privacy half is the one a rewrite loses first.

**The refusal this replaced, for anyone reading an older run.** While the non-partial
`movements_slug_unique` lived, Postgres inferred **both** arbiters for
`ON CONFLICT (slug) WHERE household_id IS NULL` — the non-partial one's empty predicate is trivially
implied by the partial one's — so the global row was **absorbed and never inserted** while `db:seed`
reported success (measured; `db:verify` still asserts that baseline, now inverted). The failure was
**silence**, so the guard refused rather than adopting, and it refused **non-wedgingly**: detect before
any movement write, omit only the shadowed rows, let every other table seed, throw at the end. But
`db:seed` runs against **production** on every push to `main`, so that throw turned the job red on
every subsequent push and **could not clear itself by re-running** — the second reason `TEN-2c` demoted
it. On such a run, unrelated reference data **did** reach prod; only the named catalog row(s) were
missing, and option 1 or 2 above was the fix. ✅ `.github/workflows/migrate.yml`'s header comment
**no longer** describes this refusal as current — `TEN-2d` corrected it (2026-10-13).

## Rename / correct a seeded profile in prod

⚠️ **Since `OPS-2` PR 1 production's seed writes no profile at all**, so this is only for a profile an
older seed wrote. The seeded household and its athletes are removed by `CAT-3`'s fresh start.

**When:** the seed changed a profile's name (or similar reference value) but prod already had the row.
The seed is `ON CONFLICT (public_id) DO NOTHING`, so it **won't overwrite** an existing row — a
one-off `UPDATE` is needed. (First occurrence: V1-3 changed the seed profile's name, and prod kept the
name it already had. ⚠️ **`OSS-1` changed those seed names again** — to the role names
`SEED_PROFILE_NAME` / `SEED_PROFILE_2_NAME` — and deliberately did **not** reconcile prod. A live
household's profile names are its own data; the sweep was about the repository, not the database.)

**Why manual:** deliberately not in the seed — an `ON CONFLICT DO UPDATE SET name` would clobber a
name a user later edits. A targeted, guarded correction is safer as a one-off.

**Steps** (Neon dashboard → **mat-plan** project → confirm the **production** database → **SQL Editor**):

```sql
UPDATE profiles
SET name = '<the new name>', updated_at = now()
WHERE public_id = '<the target row''s public_id>'
  AND name = '<the name it has now>'  -- guard → no-op if already renamed
  AND deleted_at IS NULL;
```

Expect `UPDATE 1` (or `UPDATE 0` if already done). Verify:

```sql
SELECT public_id, name, kind FROM profiles WHERE deleted_at IS NULL ORDER BY id;
```

**Safety:** targets one row by `public_id`; the `name =` guard makes it idempotent; bumps `updated_at`
for LWW hygiene; skips soft-deleted rows.

---

## OPS-1 — isolate Vercel previews from production (do this ONCE, before merging the OPS-1 PR)

**When:** once, to execute the dashboard half of
[OPS-1](./plans/ops-1-preview-isolation.md). **Until this has been run, OPS-1 is not done** — the
repo half only makes a mis-wiring fail loudly; it cannot create a Neon project or split a Vercel
scope.

**Why it's manual:** Vercel environment scopes, Neon projects and Upstash databases live in web
dashboards. No credential for any of them exists in this repo, deliberately.

> ⚠️ **Run this BEFORE merging the OPS-1 PR.** Pre-merge code reads none of the new variables, so
> every step below is safe to do first and no other PR's preview breaks. Merge afterwards and the
> guard is already satisfied. Merge **first** and every open PR's preview build — Dependabot's
> included — fails until step 5 is done. That failure is the guard working, not a defect, but there
> is no reason to pay for it.
>
> **The one exception is the OPS-1 PR's own preview.** It runs the guard before anything is merged,
> so its Vercel check stays red until step 5 is done, failing with
> `Refusing to boot: VERCEL_ENV=preview, but DATABASE_URL does not name a preview database`. That red
> is expected. Redeploy the preview after step 5 and it should go green, which doubles as the
> end-to-end proof that the split worked.

> 🔑 **Token hygiene for step 8.** A Vercel API token is account- or team-scoped and has **no
> read-only scope**: it can decrypt every production environment variable and create deployments.
> Create it **team-scoped with the shortest expiry Vercel offers**, pass it with `read -s
VERCEL_TOKEN` so it misses your shell history, and **revoke it at the end**. It never goes in
> GitHub Actions secrets — see the guard's header for why.

### 0. Preflight — three things to confirm before touching anything

**0a. The production database's name must NOT contain `preview`.** Check it in the Neon console (it is
the last path segment of the connection string; Neon's default is `neondb`). This is the one way
merging the OPS-1 PR could break the **production** build: the guard refuses a production deployment
whose database name looks like a preview database's. If production's name does contain `preview`,
stop and say so — the token in `packages/shared/src/db-environment.ts` has to change first.

**0b and 0c — the two Vercel project settings the guard depends on**

1. **Project → Settings → Environment Variables → "Enable access to System Environment
   Variables"** (0b). Must be **on**. `VERCEL_ENV` does not exist without it, and that is the input
   `apps/web/lib/env.ts` reads. (The guard still fails closed without it — it refuses any non-local
   database when `VERCEL_ENV` is absent — so builds break rather than leak. But they break with a
   message that has to guess at the cause.)
2. **Project → Settings → Deployment Protection** (0c). **Record what your plan offers and what is
   currently set**, in the PR or a note. Vercel ships two different things here — _Vercel
   Authentication_ (SSO-gated previews) and _Password Protection_ — and they are not the same
   product or the same price. If SSO-gated previews are available, previews stop being
   world-reachable and the access-gate code stops being the only control. **The trade-off is real:**
   with it on, a reviewer without Vercel access cannot open a preview, which is the box
   [definition-of-done.md](./definition-of-done.md) calls "preview deploy manually verified".

**Confirm:** production's database name has no `preview` in it, and both settings are written down
with their current values.

**Recorded 2026-10-09:** _Vercel Authentication_ is **on** for previews, so only members of the Vercel
team can open one. The DoD's "preview deploy manually verified" box says what that costs an outside
reviewer ([definition-of-done.md](./definition-of-done.md)).

### 1. Confirm fork-PR protection

**Project → Settings → Git → fork protection** (wording may differ; it is the setting that requires
authorization before a deployment from a fork). **Toggle it off, save, on, save.**

The off/on dance is not superstition: `gitForkProtection` appears in no `required` list in Vercel's
API schema, so on a project whose toggle was never written the field can be **absent**, and step 8's
check then reports "could not verify" rather than green. Writing it persists the field.

**Why this control matters, precisely:** it does not stop a fork from _reading_ data. It stops a fork
PR's **build from executing attacker-controlled code with the Preview scope's environment** — a
hostile `postinstall`, `next.config.ts` or build script exfiltrates the preview database string and
the preview gate code in a single request. This repo is public.

**Confirm:** step 8's `fork-PR protection: on`.

### 2. Create the preview Neon project

Neon → **New project**.

| Setting      | Value              | Why                                                   |
| ------------ | ------------------ | ----------------------------------------------------- |
| Project name | `mat-plan-preview` | A **separate project**, never a branch of production. |
| Database     | `mat_plan_preview` | **Load-bearing** — see below.                         |
| Region       | same as production | Latency only.                                         |

**Never a Neon branch of production.** A branch is a copy-on-write clone, so it would put every
family's bodyweight into every preview. That is the one shape OPS-1 exists to rule out.

**The database name is load-bearing, not cosmetic.** `apps/web/lib/env.ts` decides whether a
deployment is correctly wired by checking that the database name contains `preview`, because the name
is the only thing inside a deployment that reflects the _real connection string_ rather than another
declaration. Name it anything else and every preview build fails; name it like production and the
guard cannot help you.

Copy **both** strings: pooled (host contains `-pooler`) and direct/unpooled.

**Confirm:** the Neon dashboard shows a project `mat-plan-preview` with a database
`mat_plan_preview`, separate from (not a branch of) the production project.

### 3. Migrate + seed it from your machine

Paste these **one line at a time**, pressing Enter after each. Pasted as a block, `read -s` reads
nothing and the variable stays empty (both scripts then stop with "Set DATABASE_URL_UNPOOLED"), and
zsh passes a trailing `# comment` to the command as arguments unless `interactive_comments` is set.
At `read -s PREVIEW_DIRECT`, paste the preview **direct** (unpooled) string at the blank prompt.

```bash
read -s PREVIEW_DIRECT
export EXPECTED_DB_ENV=preview
DATABASE_URL_UNPOOLED="$PREVIEW_DIRECT" pnpm --filter @mat-plan/db db:migrate
# SEED_FIXTURES=1: the preview gets the program fixtures, as migrate-preview.yml seeds it (FAM-1 D10).
SEED_FIXTURES=1 DATABASE_URL_UNPOOLED="$PREVIEW_DIRECT" pnpm --filter @mat-plan/db db:seed
unset EXPECTED_DB_ENV PREVIEW_DIRECT
```

`EXPECTED_DB_ENV=preview` makes both scripts **refuse** a string that does not name a preview
database — so if you paste the production string by mistake, nothing is applied.

**Confirm:** both commands print their `✓` line. In the Neon console the `units`, `profiles`,
`entries` tables exist and `units` is seeded.

### 4. A second Upstash database, for Preview

[console.upstash.com](https://console.upstash.com) → **Create Database** → Redis, name
`mat-plan-ratelimit-preview`, same region, Regional. Copy the **REST API** URL + token (not the
`redis://` string — see [service-setup.md](./service-setup.md) §1).

**This is not optional hardening.** Preview URLs are **publicly listed** — `gh api
repos/<owner>/<repo>/deployments` plus `/statuses` returns `environment_url` for every preview ever
made, anonymously, because the repo is public. With no Upstash credentials `lib/rate-limit.ts` sets
`limiter = null` and fails open, so the preview estate would be a publicly-listed URL in front of an
**unlimited** password oracle on the only control it has.

**Confirm:** two Upstash databases exist, and the preview one's REST URL differs from production's.

### 5. Split the Vercel environment scopes

**Project → Settings → Environment Variables.** The rule: **no variable may target more than one
scope.** Create a separate record per scope, even where the value is the same.

| Variable                   | Production            | Preview                  | Development         |
| -------------------------- | --------------------- | ------------------------ | ------------------- |
| `DATABASE_URL`             | production **pooled** | preview **pooled**       | preview **pooled**  |
| ~~`ACCESS_GATE_PASSWORD`~~ | **retired at 1d**     | **retired at 1d**        | **retired at 1d**   |
| `CLERK_SECRET_KEY`         | production instance   | **development instance** | development         |
| `UPSTASH_REDIS_REST_URL`   | production            | the step-4 database      | the step-4 database |
| `UPSTASH_REDIS_REST_TOKEN` | production            | the step-4 database      | the step-4 database |
| `SENTRY_DSN`               | production            | **unset**                | **unset**           |
| `SKIP_ENV_VALIDATION`      | **never**             | **never**                | **never**           |
| `ALLOW_LIVE_DB`            | **never**             | **never**                | **never**           |

- **Development gets the preview string too.** Vercel's Development scope held the same production
  values, and `vercel env pull` hands those to a laptop. `pnpm dev` uses an embedded Postgres and
  does not read it, so there is no reason for it ever to hold production.
- **The preview gate code must be long and random**, not memorable: with Upstash wired the limiter is
  ~10 attempts per 10 minutes per IP, and without it there is no limit at all.
- **`SENTRY_DSN` unset for Preview** — preview errors reproduce locally, and a shared DSN both mixes
  preview noise into the production inbox and puts a production credential in the Preview scope,
  which is the thing OPS-1 forbids. (A separate Sentry _project_ for Preview is fine if you want it.)
- **`SKIP_ENV_VALIDATION` is never the fix for a red build.** It turns off env validation including
  OPS-1's database guard — silently. The fix is always to correct that scope's `DATABASE_URL`. Step
  8 fails if the variable exists in any scope.

**Confirm:** step 8's `no variable shares the production scope` and `DATABASE_URL exists per scope`.

### 6. The GitHub Actions secret

Repo → **Settings → Secrets and variables → Actions → New repository secret**:
`PREVIEW_DATABASE_URL_UNPOOLED` = the preview **direct/unpooled** string.

Eyeball the list: it should hold `PREVIEW_DATABASE_URL_UNPOOLED` and the production string, which is
`PROD_DATABASE_URL_UNPOOLED` since `OPS-2` PR 1 (before it, `DATABASE_URL_UNPOOLED`), and nothing else
database-related. `migrate-preview.yml` runs only on push to `main` and
`workflow_dispatch`, so a fork never sees either secret.

_Optional hardening:_ move both into a GitHub **Environment** with a `main`-only deployment-branch
policy, so a future workflow cannot reference them by accident.

**Confirm:** the next push to `main` shows "Migrate + seed (preview database)" green **without** the
`PREVIEW_DATABASE_URL_UNPOOLED not set — skipping` warning.

### 7. Purge the historical previews, and rotate what they hold ⚠️

**This is the step the backlog row's own wording misses, and it is the most important one.**

Vercel injects environment values **at build time**, so re-scoping the project in step 5 changes
nothing for a deployment that has already shipped. Every preview built before today still holds the
**production** `DATABASE_URL` and the **production** `ACCESS_GATE_PASSWORD` in its runtime
environment — and their URLs are publicly enumerable:

```bash
gh api "repos/<owner>/<repo>/deployments?environment=Preview&per_page=100" --jq 'length'
gh api "repos/<owner>/<repo>/deployments/<id>/statuses" --jq '.[0].environment_url'
```

At the time OPS-1 was written that listed **100** deployments, and the recent ones answered `200`.
When the runbook was executed (2026-10-09), Vercel held **440** preview deployments.

1. **Record two or three of those `environment_url`s** so you can verify the purge. Note what each
   answers now: behind Vercel Authentication a live deployment answers **302** (a login redirect),
   not `200`.
2. **Delete every preview deployment with `pnpm preview:purge`**, using the same token and ids as
   step 8. The dashboard has no bulk delete, so one at a time is hours of clicking. The script lists
   preview deployments only and never production. It is a dry run unless you pass `--yes`, and it
   waits out Vercel's delete rate limit (about 200 per window, then `429 … try again in 10 m`) instead
   of failing. Re-running it picks up whatever is left.
   ```bash
   pnpm preview:purge
   pnpm preview:purge --yes
   ```
3. ~~**Rotate `ACCESS_GATE_PASSWORD` in the Production scope**~~ — ⚠️ **retired at `AUTH-1` 1d**; the
   variable no longer exists. This step is kept struck rather than deleted because the steps are
   numbered and referenced from the text above. Rotate `CLERK_SECRET_KEY` instead, and
   redeploy production.
4. **Rotate the Neon production role password only if the string could have left the server.**
   `DATABASE_URL` is read server-side and never sent to a browser, so a purged preview did not expose
   it to a visitor. Rotate when any of these holds: a **fork PR** ever built with the Preview scope
   (its build runs attacker-controlled code), the string appeared in a **log**, a **client bundle** or
   a commit, or a non-maintainer ever had Vercel access. To rotate, reset the role in Neon and update
   **both** copies (`DATABASE_URL` in Vercel Production, the `PROD_DATABASE_URL_UNPOOLED` Actions secret;
   `DATABASE_URL_UNPOOLED` before `OPS-2` PR 1, and never re-created after it),
   redeploy production, and re-run "Migrate + seed (production)". _2026-10-09: skipped by decision —
   the repo has never had a fork PR, and only the maintainer has used the app or held Vercel access._

**Rotation is not retroactive, and that generalises.** A credential that was ever injected into a
build stays in that build. So whenever the _preview_ credentials are rotated later, the previews
built before the rotation must be **purged**, not merely superseded.

**Confirm:** `curl -so /dev/null -w '%{http_code}\n' <a recorded URL>` returns **`404`** for every
recorded URL (a `302` means it still exists), `pnpm preview:purge` (dry run) lists no deployment
older than step 5, and the production URL accepts the new gate code and rejects the old one. **Do not
use GitHub's deployment count as the check:** GitHub keeps its own deployment records, so that count
never drops when Vercel deletes a deployment.

### 8. Verify it mechanically

```bash
read -s VERCEL_TOKEN
export VERCEL_TOKEN VERCEL_PROJECT_ID=prj_… VERCEL_TEAM_ID=team_…
pnpm preview:check
unset VERCEL_TOKEN VERCEL_PROJECT_ID VERCEL_TEAM_ID
```

The project id is under Project → Settings → General and the team id under Team → Settings →
General; paste the lines one at a time, as in step 3.

Exit **0** = isolated · **1** = isolation is broken · **2** = could not check, so **nothing was
asserted** (an unreachable API, an expired token, or an unexpected response shape all land here
rather than being reported as a pass).

**Then revoke the token** (Vercel → Account Settings → Tokens).

> 🔒 **Do not paste the output into a public PR or issue.** The pass/fail verdict is the shareable
> part; the per-scope **key inventory** it prints and your project id are not.

**What this proves:** fork protection is on, system environment variables are exposed, no variable
carries the production scope into another scope, `SKIP_ENV_VALIDATION` exists nowhere, and
`DATABASE_URL` has its own record per scope. It reads **structure only** — it never decrypts, never
fetches a variable by id, and prints no value.

**What it cannot prove, so check by hand:** that two _distinct_ records do not hold the _same_ value
(that needs decryption, which it deliberately never does); which Neon project a string actually
points at; that the preview database holds no real family's data; and anything at all about
historical deployments — step 7 is the only control there.

### 9. Merge, then land the closeout commit

1. Merge the OPS-1 PR.
2. **Closeout commit** (one small PR):
   - `.github/workflows/migrate-preview.yml` — change the missing-secret branch from `exit 0` to
     `exit 1`. The green skip is deliberately temporary: a `::warning::` on a green job is invisible
     a week later, which is the claimed-but-unwired-gate shape [tech-debt.md](./tech-debt.md) exists
     to log.
   - `docs/plan.md` — tick OPS-1, and remove the "dashboard half outstanding" note.
   - `docs/tech-debt.md` — drop the preview-migrate-skip entry.

**Confirm:** `docs/plan.md`'s OPS-1 row no longer says the dashboard half is outstanding.

### Standing: reset the preview database

**The preview project is disposable, and that is a design property rather than a convenience.** A
preview is where write paths get exercised, so it accumulates whatever any reviewer types; it does
**not** hold "seed data only" after the first preview. And `seed.ts` is `onConflictDoNothing` keyed on
`public_id`, so it **re-creates** a fixture profile that was soft-deleted while rehearsing a deletion
flow, on the next push to `main`.

Reset it — **before a demo, after a deletion rehearsal, and whenever a reviewer has entered values**:

**Cheapest: recreate the database, not the project.** The host, role and password survive, so every
stored connection string (Vercel Preview + Development `DATABASE_URL`, the
`PREVIEW_DATABASE_URL_UNPOOLED` secret) stays valid and nothing needs re-pasting. No terminal either.

1. Neon → **`mat-plan-preview`** project → **Databases**. Note `mat_plan_preview`'s **owner**, then
   delete it.
2. **New Database**: name exactly `mat_plan_preview` (the guard and the stored strings depend on it),
   owner the same role.
3. GitHub → Actions → **"Migrate + seed (preview database)"** → **Run workflow** on `main`. It ends
   with `✓ migrations applied` and `✓ seed complete`.
4. **Confirm:** a preview's picker shows the fixture athletes (`SEED_PROFILE_NAME` /
   `SEED_PROFILE_2_NAME` in `packages/shared/src/seed-ids.ts`) and nothing anyone typed.

**Only when the role password itself must change** (a suspected leak of the preview string): delete
the whole `mat-plan-preview` project, repeat steps 2 and 3 above, then update `DATABASE_URL` in the
Vercel Preview + Development scopes and the `PREVIEW_DATABASE_URL_UNPOOLED` secret with the new
strings. Purge the previews built before the change (step 7's rule: rotation is not retroactive).

This is also how the preview estate picks up a fixture **rename** (OSS-1 follow-up #2): because a
rename is fresh-DB-only under `onConflictDoNothing`, the preview project takes it by being recreated,
not by a second manual `UPDATE`.

### Standing: if a fork preview ever builds

Treat the Preview scope as compromised: rotate the preview Neon role password and the preview
`ACCESS_GATE_PASSWORD`, update the Vercel scopes and the Actions secret, and **purge that
deployment** (rotation is not retroactive).

### What is still true after all of this

- A preview is a **publicly-listed, internet-reachable** deployment. Unless step 0's Deployment
  Protection is on, its only control is a shared code.
- ⚠️ **`/api` IS inside the proxy matcher since `AUTH-1` 1a** — this bullet said "not gated at all"
  and cited a `tech-debt.md` entry that no longer exists. The security headers reach `/api/*`.
  **The operational conclusion is unchanged**, and `1d` narrows the reason rather than removing it:
  the matcher is not the boundary and a handler's own session check is what holds — so once a
  **mutating** Route Handler exists, still assume the preview database is writable by anyone who can
  sign in to the preview's Clerk instance. ⚠️ That is now a **development** Clerk instance with
  shared OAuth credentials, not a shared code — a different exposure, not a smaller one to assume.
- The preview Neon project has **no IP allowlist** on the free tier: the connection string is full
  DDL access, and it now lives in two places (the Vercel Preview scope and an Actions secret).
- **Therefore the preview estate must hold nothing you would mind being public.** That is the whole
  reason a Neon branch of production was never an option.

---

## Manually re-seed / re-apply prod (`workflow_dispatch`)

**When:** you need the prod migrate+seed to run out-of-band (e.g. a catch-up before the change merges,
or after creating the `PROD_DATABASE_URL_UNPOOLED` secret). Since `migrate.yml` now runs on **every** push to
`main`, this is rarely needed — merging is usually enough.

**Steps:** GitHub → **Actions** → **"Migrate + seed (production)"** → **Run workflow** → branch `main`
→ Run. Since OPS-1 the job is guarded with `if: github.ref == 'refs/heads/main'`, so a dispatch from
any other branch is a no-op rather than applying that branch's unmerged migrations to production —
the instruction to pick `main` is now enforced, not just written down. To refresh the **preview**
database from a branch, run `db:migrate` locally against the preview string (OPS-1 step 3), or
dispatch **"Migrate + seed (preview database)"**, which holds no production credential. Check the "Apply migrations + idempotent seed" step is green (since `OPS-2` PR 1 a missing
`PROD_DATABASE_URL_UNPOOLED` fails it rather than skipping) and printed `✓ seed complete (reference
data only)`. ⚠️ **Never "Re-run jobs" on an old run**, and hand-run a seed only from a freshly fetched
`origin/main`: older seed code wrote households and athletes.

**A seed that timed out** (`canceling statement due to lock timeout`, or `statement timeout`, in the
"Apply migrations + idempotent seed" step, since `OPS-2` PR 1 set both): the migration step before it
had already committed, so the migrations **are** applied; only the seed must run again. Dispatch the
workflow from `main` once nothing is holding the lock. Its statements are idempotent, so a partly
written reference table is completed, not duplicated.

**Safety:** `db:migrate` is a no-op when nothing is pending, and production's `db:seed` writes
reference data only (`OPS-2` PR 1), idempotently, so it never refuses on a household. The fixture
seed (`SEED_FIXTURES=1`, local and preview only) still refuses to seed into a household it does not
own (`AUTH-1` 1c-4).

---

<!-- Placeholder runbooks — fill in when first needed. Keep titles even before the body exists so we
     have a known home for each procedure. -->

## A household or athlete with a seed id (`OPS-2`)

**Since `OPS-2` PR 1 production's `db:seed` writes reference data only:** no household, no athlete, no
program (`packages/db/src/seed.ts` → `seedReference`; the rest is `seedFixtures`, written only with
`SEED_FIXTURES`, which `migrate.yml` never sets). So the current seed can neither re-create a deleted
household nor refuse on one. **Older seed code still can**, through "Re-run jobs" on an old
`migrate.yml` run or a hand-run from a stale checkout, so one rule still holds:

🔴 **A household or athlete whose `public_id` is in `SEED_PUBLIC_IDS`** (`packages/shared/src/seed-ids.ts`)
**is never removed by "Delete a household" or "Erase one athlete".** The seeded household is removed,
with everything in it, by `CAT-3`'s fresh start (`docs/specs/cat-3-movement-library.md` → "The fresh
start, in order", step 3). A seed-id row it does not reach is removed only after `SEC-6`'s re-key gives
it an ordinary id. A household or athlete created in the app is unaffected.

**The check: run it immediately before the fresh start's step 3, before `PRIV-3` RC's production
`--apply`, and before deleting a re-keyed seed row**, with merges frozen until that step commits. It is
also what "`OPS-2` PR 1 is deployed" means:

```bash
git fetch origin
MAIN=$(git rev-parse origin/main)
# 1. Production's seed ran the current main, successfully, and nothing is queued or running —
#    including a re-run of an OLD run, which keeps its old creation time.
gh run list --workflow migrate.yml --branch main -L 5 --json databaseId,headSha,status,conclusion,updatedAt
#    → the newest row: headSha == $MAIN, status completed, conclusion success.
# A finished re-run of an OLD run sorts by its old creation time, so scan the whole re-run window
# (GitHub allows re-runs for 30 days), not the newest rows:
gh run list --workflow migrate.yml --created ">=$(date -u -v-31d +%F 2>/dev/null || date -u -d '31 days ago' +%F)" \
  -L 1000 --json databaseId,attempt,updatedAt -q '[.[] | select(.attempt > 1)]'
#    → no entry whose updatedAt is later than the newest green run's.
# 0. The control itself: the old secret is gone (needs the maintainer's token).
gh secret list --app actions --json name -q '.[].name' | grep -x DATABASE_URL_UNPOOLED   # → no output
for st in in_progress queued waiting pending requested; do
  gh run list --workflow migrate.yml --status "$st" --json databaseId,headSha   # → [] each time
done
gh run view <databaseId> --log | grep -F '✓ seed complete (reference data only)'
# 2. db:verify (which carries OPS-2's proofs) passed on that same commit.
gh run list --workflow ci.yml --commit "$MAIN" --json conclusion,status
```

**The rules that go with it:**

- **Never "Re-run jobs" on an old `migrate.yml` run.** Since `OPS-2` PR 1 the production string is the
  `PROD_DATABASE_URL_UNPOOLED` secret, and once the old `DATABASE_URL_UNPOOLED` is deleted an old run
  finds it empty and exits 0 with a warning, writing nothing ("Rotate or rename the production
  database secret", below). Until it is deleted, the rule is only written down. The cut-off is two
  commits: `OPS-2` PR 1 (no household or athlete) and `CAT-3` A2 (no legacy movements).
  `workflow_dispatch` is safe: it runs `main`.
- **Hand-run a seed only from a freshly fetched `origin/main`** ("Manually re-seed", above).
- Production's `migrate.yml` runs are **never deleted**: they are the record of which DDL reached
  production and when.
- **From the fresh start's step 3 on, `OPS-2` PR 1 is fixed forward only**: a revert would re-create
  the seeded household on the next push.

---

## "Sign-in is broken in dev or preview" — tell the four causes apart

A **reusable diagnostic**, not the story of one evening: each command below distinguishes two causes,
and production can be fine while both of the others are broken, which is exactly what makes this
confusing. Run them in order; stop at the first that explains what you see.

**1. Is the thing on `localhost:3000` even mat-plan?**

```bash
curl -s localhost:3000/ | grep -o '<title>[^<]*</title>'
```

`<title>mat-plan…` → it is ours. Anything else — `Create Next App`, another project — and **every
mat-plan route will 404**, which reads exactly like "auth is broken" because `/sign-in` is one of
them. `apps/web/scripts/dev-local.ts` spawns `next dev` with **no explicit port**, so when 3000 is
taken Next silently moves to **3001** and prints it; a browser tab left on 3000 is then showing a
different app. Check the port `pnpm dev` actually printed, or free 3000:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN     # who has it
curl -s localhost:3001/ | grep -o '<title>[^<]*</title>'
```

**2. Is Clerk configured at all in the environment you are looking at?**

The page says **"Signing in with Google isn't switched on yet."** ⇒ `clerkIsConfigured()` is false
⇒ one or both of `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` is missing from **that
environment's** scope. Both keys are `.optional()` in `lib/env.ts` **by design** (`lib/clerk.ts`
explains why), so a missing key is a dark page, never a boot failure — which is safe and silent.

```bash
# dev: presence only, never print the value
grep -c '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' apps/web/.env.local
grep -c '^CLERK_SECRET_KEY=' apps/web/.env.local
```

For **Preview**, the keys live in Vercel's Preview scope, which `OPS-1` deliberately separated from
Production — so setting production keys does **not** give previews any. ⚠️ `pnpm preview:check`
audits Preview for _production credentials leaking in_; it says nothing about Clerk keys being
_absent_, so a dark preview passes it.

**3. If Preview has keys, are they the TEST ones?**

A Clerk **production** instance is domain-locked to the domain configured for it (`clerk.mat-plan.dev`).
A preview is served from `*.vercel.app`, so production keys there cannot work no matter how they are
set. Previews need the **development** instance (`pk_test_…` / `sk_test_…`), which is reachable from
any origin. Check which instance a key points at without revealing it — the publishable key is public
by design and encodes its own Frontend API host:

```bash
# prints only the host, not the key
grep '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' apps/web/.env.local | cut -d= -f2- \
  | sed 's/^pk_[a-z]*_//' | tr -d '"' | base64 -d | tr -d '$'
```

`…clerk.accounts.dev` = development instance. `clerk.<your-domain>` = production instance.

**4. Is the instance itself alive and carrying Google?**

```bash
curl -s "https://<that-host>/v1/environment?__clerk_api_version=2025-04-10&_clerk_js_version=5" \
  | head -c 200
```

`"identification_strategies":["oauth_google"]` ⇒ the instance is up and Google is on, so the fault is
in **our** wiring (step 1–3), not Clerk's.

⚠️ **A preview URL that returns `<title>Login – Vercel</title>` is Vercel Deployment Protection**, not
our app and not Clerk — an anonymous fetch cannot get past it, so curl-based checks of a preview test
nothing until you are signed in to Vercel in that browser.

## The fresh start (`CAT-3` R2) — ONE TIME

> 🔴 **One time.** This section runs once, on the maintainer's go (spec R5: _"the fresh start runs
> only on the maintainer's go, recorded with its date"_), and the spec's post-R2 cleanup removes it
> afterwards so it never becomes a permanent list of dated steps. The plan is
> [priv-3-fresh-start-prep.md](./plans/priv-3-fresh-start-prep.md); the order is the spec's
> ([cat-3-movement-library.md](./specs/cat-3-movement-library.md) → "The fresh start, in order").

**Preconditions** (the spec's list, every one checked before step 0): FAM-1 step 15, P11 and B3 in
production; `OPS-2` PR 1 deployed (§ "A household or athlete with a seed id", the check); A2 deployed;
`PRIV-3` 2a, RC and R0 merged; a launch-sized catalog on `main`; the maintainer's go, with its date.

**How every production command here is run:**

- **In the operator's own terminal, never in an agent session**, so no credential or count reaches a
  transcript.
- **The production direct string is read once and never typed into a command line.** History is the
  leak (§ "Rotate a secret"):

  ```bash
  read -rs PROD_DB   # paste the production DIRECT (unpooled) string, then Enter; it does not echo
  ```

  Each command passes it inline as `DATABASE_URL_UNPOOLED="$PROD_DB"`, and step 8 ends with
  `unset PROD_DB`.

- **The output stays on the terminal.** Never paste it into a PR, an issue or the corrections
  **Applied** table: the counts describe one family.

### Step 0 — before anything is frozen

1. **Only the seeded household exists.** Run step 3's dry run (below). It must print
   `households not in SEED_PUBLIC_IDS: live 0, hidden 0`. Anything else stops the fresh start: no tool
   here removes another household.
2. **The household's data, offered first** (K15): each athlete's in-app export is taken, **and** the
   full copy is offered (the in-app export leaves out hidden rows; § "Delete a household", step 1).
   Either is taken, or the go records that it was declined.
3. **The dry run's membership line** (`household_members: live L, hidden H`): an account whose only
   membership is hidden is decided at the go and recorded in the ledger (step 3 deletes that row, and
   step 7 binds only the accounts it is given).
4. **The close-out notice PR** is open as a draft (plan D5).

### Step 1 — freeze merges

Tell the lanes. The newest `migrate.yml` run on `main` is green on `main`'s head, with nothing queued
or running (§ "A household or athlete with a seed id", the check's step 1).

_Second run:_ nothing to repeat.

### Step 2 — cut the restore branch

§ "Cut a Neon RESTORE branch". Write the ledger entry for this erasure (§ "The deletion ledger": the
household grain, the seeded household's `public_id`, **no Clerk ids**, the go as the verifying
channel, the export outcome, and the branch's name and expiry).

_Second run:_ keep the same branch; do not cut a second one.

### Step 3 — erase the seeded household (R0)

```bash
DATABASE_URL_UNPOOLED="$PROD_DB" pnpm --filter @mat-plan/db db:correct erase-seeded-household-2026-11-19
#   → per-table counts, "total: N row(s)", any pre-flight that will refuse, the memberships line,
#     the other-households line, then "T table(s), N row(s) would be erased …".
EXPECT_ERASED_ROWS=N DATABASE_URL_UNPOOLED="$PROD_DB" \
  pnpm --filter @mat-plan/db db:correct erase-seeded-household-2026-11-19 --apply
#   → "✓ erased T table(s), N row(s)." and "Do NOT delete the Clerk users step 7 binds".
```

`N` is the dry run's total, typed back. **Do not delete any Clerk user** that step 7 binds (K15).

**If `--apply` refuses or fails, nothing was erased** (one transaction). Then:

- **A total mismatch** (`… but EXPECT_ERASED_ROWS is …`): someone logged between the dry run and
  `--apply`. Re-run the dry run, then `--apply` with the new total.
- **`40P01` (deadlock) or `55P03` (lock timeout)** in `failed (nothing committed): <code> …`: the app
  was writing to the household at that moment (the core locks the parents in a fixed order, and a log
  write can take them in the other). Wait a minute, re-run the dry run, then `--apply` with its total.
  Repeated, ask the household to stop logging for a few minutes.
- **A pre-flight** (`pre-flight (x) found …`): another household depends on these rows. Stop: no tool
  here resolves it.

_Second run:_ the dry run prints `the seeded household is not here; nothing to erase`, and `--apply`
refuses. That is the success state.

### Step 4 — check that no household exists

Re-run step 3's **dry run**. It must print `the seeded household is not here` **and**
`households not in SEED_PUBLIC_IDS: live 0, hidden 0`. A household found here stops the fresh start.

### Step 5 — delete the old global movements (R1)

```bash
DATABASE_URL_UNPOOLED="$PROD_DB" pnpm --filter @mat-plan/db db:correct delete-legacy-movements-<date>
EXPECT_LEGACY_MOVEMENTS=M EXPECT_LEGACY_EQUIPMENT=E EXPECT_LEGACY_MUSCLES=U DATABASE_URL_UNPOOLED="$PROD_DB" \
  pnpm --filter @mat-plan/db db:correct delete-legacy-movements-<date> --apply
```

It removes only global movements that are **not** catalog rows (`movementIsCatalog()`), never by slug,
and refuses if anything still references one. Catalog rows A2 has already seeded stay.

_Second run:_ `nothing to do`.

### Step 6 — seed the catalog

Dispatch `migrate.yml` on `main` (`workflow_dispatch`). Its migrate step has nothing to do; its seed
inserts every catalog row. **Its log must show zero entries skipped.** If it shows any, re-run step 5,
then step 6.

### Step 7 — create the household for the adult accounts (RC)

Follow [RC's "What R1 must carry"](./plans/priv-3-rc-create-household.md) (the ids from the
**production** Clerk dashboard, read at this step, through `read -rs`, the account count said aloud
before the dry run), then `create-household-2026-11-17`'s dry run and `--apply`.

### Step 8 — the report, then unfreeze

`movements-ownership-…` (R4): every `R4 (n)` line reads 0. Then `unset PROD_DB`, unfreeze merges, and
merge the close-out notice PR. **If the run stopped after step 3**, the close-out's athlete and
household sentences still merge: they became true at step 3.

### Step 9 — the household rebuilds

The household signs in, adds its athletes and builds its program.

### Never after step 7

**Production is never restored to any point before step 3** once step 7 has run — not from the step-2
branch, not by point-in-time restore. If it ever is, steps 3 to 8 run again. Never attach compute to
the step-2 branch during steps 3 to 8: it passes every gate the erasure has (same name, same rows).

## Rotate a secret (Clerk key / Neon password / GitHub Actions secret)

_Still a TODO as a general procedure._ **Two cases are written up.** ⚠️ The access-gate code was the
original worked example and is gone — `AUTH-1` 1d deleted the variable — so what replaced it is a
rotation that has actually been performed rather than one written from imagination.

**`CLERK_SECRET_KEY` — performed 2026-11-04, and it fixed a live production outage.**

1. Clerk dashboard → API keys → regenerate the **secret** key for the **production** instance.
2. Set it in Vercel's **Production** scope, alongside `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — both, even
   if only one changed, so the pair cannot drift.
3. **Redeploy.** The key is read at runtime, but `lib/env.ts` validates at import, so a deploy is what
   proves the new value is actually present.
4. Sign in. ⚠️ **The symptom this fixed is worth knowing, because its cause was invisible:** sign-in
   looped — `/sign-in` → a flash of the app → back to `/sign-in` — and the browser console carried
   `clerkReason: "unexpected-error"` while a valid-looking `__session` JWT was being issued. The key
   had the right FORMAT (`sk_live_…`) and was still wrong, so "check it starts with `sk_live_`" does
   not distinguish the two. **Regenerating is the diagnostic**: if a correctly-shaped live key
   produces `unexpected-error`, replace it rather than inspecting it further.

**The Neon role password + Actions secret — OPS-1 step 7**, propagating to the Vercel Production scope
and the `PROD_DATABASE_URL_UNPOOLED` Actions secret (never re-create the old `DATABASE_URL_UNPOOLED`: see
"Rotate or rename the production database secret" below): see
[OPS-1 step 7](#7-purge-the-historical-previews-and-rotate-what-they-hold-️) above.

### Rotate or rename the production database secret (`OPS-2` PR 1)

`migrate.yml` reads production's direct string from **`PROD_DATABASE_URL_UNPOOLED`** since `OPS-2` PR 1
(the maintainer's decision, 2026-11-18). The old name, `DATABASE_URL_UNPOOLED`, is deleted once the new
one is proved, so a re-run of an old `migrate.yml` run finds it empty and writes nothing. The steps,
in order:

1. **Before the PR merges:** Neon → the **mat-plan** production project → **Connection details** → the
   **direct** (not `-pooler`) string for the production database, `sslmode=require`. GitHub → repo →
   **Settings → Environments → Production → Add environment secret** (done 2026-11-18): name
   `PROD_DATABASE_URL_UNPOOLED`, value that string. `migrate.yml` declares `environment: Production`.
   🔴 **The environment's deployment-branch policy must be "Selected branches: `main`"** (Settings →
   Environments → Production → Deployment branches) **before the merge**: without it, any branch's
   workflow that declares the environment could read the secret. (GitHub cannot show the old secret's value, so copy
   it from Neon, not from GitHub.) **Check the host before saving:** it must be Vercel Production's
   `DATABASE_URL` host with `-pooler` removed (the same endpoint id), not a restore branch's and not the
   pooled one. Leave `DATABASE_URL_UNPOOLED` in place for now.
2. **Merge the PR.** Watch its `migrate.yml` run (`gh run list --workflow migrate.yml --branch main -L
1`): green, `✓ migrations applied`, and `✓ seed complete (reference data only)` in the log. If it is
   red with `PROD_DATABASE_URL_UNPOOLED is not set`, step 1 was missed: add the secret, then dispatch
   the workflow from `main`.
3. **Then delete `DATABASE_URL_UNPOOLED`** (Settings → Secrets → Actions → the secret → Remove). Nothing
   else reads it (`git grep 'secrets.DATABASE_URL_UNPOOLED'` finds nothing).
4. **Verify:** the secret list holds `PROD_DATABASE_URL_UNPOOLED` and `PREVIEW_DATABASE_URL_UNPOOLED` and
   no other database secret. Dispatch "Migrate + seed (production)" from `main` once: green, the same
   two log lines. ⚠️ Do not test the old-run guard by re-running an old run.

To **rotate** the password later, change it in Neon and update `PROD_DATABASE_URL_UNPOOLED` (and Vercel's
Production scope, OPS-1 step 7); the name stays. 🔴 **Never create a secret named `DATABASE_URL_UNPOOLED`
again**: with it present, every old `migrate.yml` run can be re-run against production with seed code
that wrote households.

Generalise from these when the next rotation comes up, and carry the one durable lesson with you:
**rotation is not retroactive.** A credential that was ever injected into a Vercel build stays in that
build, so the deployments built before a rotation have to be purged, not merely superseded.

### `CLAUDE_CODE_OAUTH_TOKEN` (the `@claude review` workflow, DX-1)

**Dormant by choice since 2026-09-30:** the secret is unset because reviews run locally (the
`review-pr` skill). An `@claude review` comment gets the "failed or ran out of budget" notice. To
activate, follow the steps below, then run the DX-1 plan's tests 3–5 before relying on it. While
dormant, a `claude-code-action` bump doesn't need step 6's re-read; activation does.

1. On a machine logged in to a Claude Pro/Max account: `claude setup-token`, and copy the token.
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**
   `CLAUDE_CODE_OAUTH_TOKEN` (or update it). Nothing else reads it; no redeploy.
3. Check: comment `@claude review` on a PR **you** opened. Until the DX-1 injection smoke (plan,
   test 4) has passed, don't `@claude review` a PR from someone else. Within ~20 minutes there is one comment, a
   review, or a notice with a run URL.
4. **Expired or revoked token:** the review job fails at the action step and the PR gets
   "claude-review failed or ran out of budget" with the run URL. Rotate with steps 1–2.
5. **If a review was ever "withheld"** (a secret pattern matched), treat the token as leaked: revoke it
   (claude.ai → settings) and rotate. Don't re-run a claude-review job with debug logging on: its
   tool output lands in a public log.
6. **A `claude-code-action` bump** (Dependabot opens it alone; it is excluded from the actions group):
   the action's SHA also fixes the CLI version (`src/entrypoints/run.ts`), the read-block semantics,
   `restore-config.ts`, the step skipped by `classify_inline_comments`, and `git-config.ts`. Re-read
   those at the new SHA against the DX-1 plan's threat model, then re-run the injection smoke (plan,
   test 4) before merging. A green CI says nothing about any of this.
7. **"failed or ran out of budget" right after a `.claude/settings.json` change** is the settings pin,
   not the budget: the prefetch refuses until `SETTINGS_SHA256` in `review-prefetch.sh` is updated.
   Re-read the threat model, then update the hash (the script's comment has the command).

## A cross-household scope miss (the TEN-1 alert)

**What fired.** A Sentry event `profile scope miss: cross_household`, or since FAM-1 the same
message for a `program`, a `workout` or a `prescription` (the table below). The server was asked for
a `public_id` that **exists**, but not in the household the request resolved to. The caller got
a 404 (page / export handler) or the shared `No profile found…` envelope (a Server Action) — ADR 0006
→ "What a wrong-household request returns". Nothing leaked; this is the signal that the refusal
happened.

**Four kinds of id since FAM-1** (contract change C11; the maintainer's decision, 2026-11-16). The
same event is raised for a program, a workout and a prescription id, each under its own message, so
each kind is its own Sentry issue:

| Message                                    | The id that was asked for                          | `scope_kind`   | `scope_action`         |
| ------------------------------------------ | -------------------------------------------------- | -------------- | ---------------------- |
| `profile scope miss: cross_household`      | an athlete's                                       | `profile`      | `resolve_profile`      |
| `program scope miss: cross_household`      | a program's (the program builder)                  | `program`      | `resolve_program`      |
| `workout scope miss: cross_household`      | a workout's (the program builder, or a ✓ on a day) | `workout`      | `resolve_workout`      |
| `prescription scope miss: cross_household` | one item of a workout's (a ✓ or a Change on a day) | `prescription` | `resolve_prescription` |

All four carry the tag `scope_outcome: cross_household`. The program builder's pages and actions and
the day page's row actions call it since FAM-1 steps 7a and 12b; on a day, a ✓ reports a workout or
a prescription id, at most one event per refused ✓.

For the three new kinds `cross_household` means exactly **"a live row with this id exists in a
household that is not the caller's"**. The caller's own id that the page does not serve (an older
seeded program, or an item asked for an athlete who is not on its program) is reported as
`unknown_resource`, at `info`, and is not a probe.

**Why the event exists at all.** The scoped predicate (`public_id ∧ deleted_at IS NULL ∧
household_id = scope`) returns "no row" for both _"unknown id"_ and _"exists elsewhere"_, so the
server cannot tell them apart — which made the threat model's #1 risk the one event that produced no
signal. On a miss only, `apps/web/lib/dal/household.ts` → `reportScopeMiss` re-resolves without the
household conjunct and emits one structured event.

**The alert** (Sentry → Monitors → Alerts, where Sentry now keeps them; created 2026-11-17 UTC):

| Field    | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| Name     | "Scope miss: cross-household probe (any kind)" (alert `6358619`), project `mat-plan` |
| Triggers | a new issue is created · an issue escalates · a resolved issue regresses             |
| Filter   | the event's `message` contains `scope miss: cross_household` (all four kinds)        |
| Action   | notify the issue's suggested assignees, else the recently active members             |
| Throttle | none: it notifies on every trigger                                                   |

🔴 **There was no such alert before 2026-11-17 (UTC).** This section described one from `TEN-1` on,
with a threshold of "more than 3 events in 1 hour". Sentry held only its default alert for
high-priority issues, and a scope miss is a `warning`, so **nothing ever notified anyone**. The
alert above was created that day by the maintainer's session, not edited from an older one. A
`cross_household` event raised before then was recorded and not alerted on: to know whether one
happened, open the issue and read its events; an empty inbox says nothing. **If such an issue
already exists and is unresolved, resolve it now**: it is not new, so a further event on it would
not notify unless Sentry calls it an escalation; resolved, the next event regresses it and does.

⚠️ **It fires per ISSUE, not per event, and has no hourly threshold.** Sentry groups events by
message and the code sets no fingerprint, so each kind's message should be its own issue; check
under Issues, since the grouping is Sentry's. The first `cross_household` event of a kind creates
the issue and notifies. A later event on that issue notifies only if Sentry marks the issue as
escalating, or if the issue had been resolved and so regresses. Two things follow:

- **Resolve the issue when triage is done.** An issue left unresolved is quiet for the next probe
  of that kind, unless Sentry calls it an escalation.
- **The count is yours to read.** Nothing counts "3 in an hour" for you: open the issue and look at
  its events and their `resource` values (Triage, below). Counting events, or the four kinds
  together, would take a metric alert on the tag `scope_outcome:cross_household`, which is not set
  up.

**What the event carries, and what it deliberately does not.** `actor` — **`clerk_session` since
`AUTH-1` 1c-3b**; it was `gate_session` while the gate was the only door, and it is a **constant
either way, never the user id**, because a requester id in a third-party store is the same
cross-tenant linkage the owning household id is forbidden for. Filter on the current value: an alert
triaged against the old one returns nothing. Plus `action`, `kind` (one of the four fixed words
above), `resource` (the `public_id` the caller already sent: a profile's, a program's, a workout's
or a prescription's) and `outcome`. **No name, no logged value, no `params:` tail** (SEC-3: drizzle's
`DrizzleQueryError` message embeds query parameters and has shipped a kid's bodyweight to Sentry
once) and **not the owning household's id** — a requester→owner mapping in a third-party store would
be a cross-tenant linkage over minors' health data.

**Triage.**

1. **One event, one `resource`** → almost certainly a stale bookmark or a shared link. No action.
2. **Many events, many distinct `resource` values** → id probing. UUIDv7 public ids are not
   enumerable, so this means ids leaked (a screenshot, a log, a shared link). Rotate the access-gate
   credential (§ "Rotate a secret" — the Clerk secret key since `AUTH-1` 1d) and re-check who has it.
3. **`scope_outcome` carries something other than `cross_household` or `unknown_resource`** → not an
   attack: the server could not resolve a household at all. 🔴 **Since `AUTH-1` 1c-4 the resolver
   reads the principal's membership, never a household count, so these mean per-PERSON things and
   the old "re-seed prod" answer is wrong for all of them.** `apps/web/lib/dal/household.ts` →
   `SCOPE_OUTCOME` is the source of the values:

   | `scope_outcome`  | What it means                                                                         | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
   | ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `no_membership`  | This signed-in account holds **no live `household_members` row**                      | **The common one.** An invited account that was never linked, the wrong Google account, or the maintainer before the claim correction. ⚠️ **The event cannot tell you WHICH account** — its payload is a fixed message and one tag, deliberately (ADR 0006 obligation 3), so events from different principals are byte-identical and group into one Sentry issue. The count tracks how many accounts are unresolved, not who. To find them, compare the live memberships against the Clerk dashboard: `SELECT household_id, role, created_at FROM household_members WHERE deleted_at IS NULL;` — one row per person who can get in, so an account the dashboard lists with no row here is in this state. Then run the claim correction for that account. Do NOT re-seed. |
   | `schema_missing` | `household_members` is not there (`42P01`/`42703`)                                    | A deploy ahead of migration `0019`, or an un-migrated preview. Fix the migration state; the app is dark for **everyone**, not one person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | `no_scope`       | A miss-path event: the request reached a scoped read with no scope at all             | The same two causes as above, seen one layer up. Triage by the resolver's own event, not this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | `no_household`   | ⚠️ **Retired at 1c-4 — nothing can emit it.** An event carrying it is OLDER than 1c-4 | Read it as history. Do not reason about current behaviour from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

4. **The app is down for ONE account with `household scope is ambiguous`** → 🔴 **this changed
   meaning at `AUTH-1` 1c-4, and the old remedy here destroyed data.** It used to mean "two or more
   live households exist", and said to soft-delete a household. It now means **one principal holds
   two or more live `household_members` rows**, which is per-account: that account gets `error.tsx`
   everywhere, everyone else is fine, and **two live households is the intended end state** once a
   family is invited. **Never soft-delete a household in response to this alert** — you would be
   deleting a real family. Find the duplicate MEMBERSHIP and soft-delete the one created in error:

   ```sql
   SELECT id, household_id, role, created_at
     FROM household_members
    WHERE deleted_at IS NULL
      AND clerk_user_id IN (
          SELECT clerk_user_id FROM household_members
           WHERE deleted_at IS NULL GROUP BY clerk_user_id HAVING count(*) > 1);
   ```

   ⚠️ **The projection deliberately omits `clerk_user_id`.** The remedy soft-deletes by `id`, and
   `household_id` + `created_at` are what you choose between, so triage never needs to print the id —
   and this section's output is the kind an operator pastes into a note. Same rule as § "The claim
   correction has been run with `--apply`": a Clerk user id is a stable third-party account
   identifier for a named adult (`docs/privacy/data-inventory.md` § 1a) and this repo is public.

## An owner-only athlete action was refused (the PROF-1 b alert)

**What fired.** A Sentry event `athlete authority refused`, tagged
`authority_outcome: owner_only`. A signed-in member of a household asked to **archive** an athlete, or
(since 2026-11-19) to **download an athlete's export**, in **their own** household, and the server refused because they are not the owner.

🔴 **This is not a cross-household event, and that is why it has its own alert.** The scope-miss
alert above covers an id reached from the wrong household. This one is _inside_ the caller's own
household, so every tenancy predicate matched and `reportScopeMiss` is silent by design.

**The alert** (Sentry → Monitors → Alerts; created 2026-11-17 UTC):

| Field    | Value                                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| Name     | "Owner-only athlete action refused (PROF-1)" (alert `6358648`), project `mat-plan` |
| Triggers | a new issue is created · an issue escalates · a resolved issue regresses           |
| Filter   | the event's `message` contains `athlete authority refused`                         |
| Action   | notify the issue's suggested assignees, else the recently active members           |
| Throttle | none: it notifies on every trigger                                                 |

The event's tags are `authority_outcome: owner_only` and `authority_action: archive_profile` or `export_profile`; the
alert filters on the message, not on them.

🔴 **There was no such alert before 2026-11-17 (UTC)**, for the reason the scope-miss section above
gives: Sentry held only its default alert for high-priority issues, and this event is a `warning`.
It was created that day by the maintainer's session. A refusal before then was recorded and not
alerted on. **If the issue already exists and is unresolved, resolve it now**, so that the next
refusal regresses it and notifies.

⚠️ **It fires per ISSUE, not per event.** Every refusal carries the same message, so they should
be one issue (Sentry groups by message; check under Issues): the first creates it and notifies, and
a later one notifies only if Sentry calls the issue escalating or the issue had been resolved.
**Resolve the issue when triage is done**, or the next refusal is quiet.

⚠️ **How many events to expect.** The app reports this event at most once per account **per act** (archive, export) per
server instance, and not at all once the per-principal bound it shares with the unresolved-scope events
fills (100 keys, held in memory; it emits `report_cap_reached` first). A caller with no user id
shares one key. And the event carries no account id. So several events mean several accounts or
several instances, and Sentry cannot tell which: read the count as "this happened more than once",
never as "one account tried N times".

**What makes it interesting rather than noise:** the UI renders **no Archive control and no export control for a
member**, so this path cannot be reached by using the app. Reaching it takes a crafted POST (archive)
or a typed export URL. One event is
plausible as a stale tab (a member whose role changed mid-session, once `INVITE-1` can change roles);
repeated events are someone probing an owner-only control (from how many accounts, the events cannot say).

⚠️ **The event deliberately carries no athlete name, no athlete id, no household id and no Clerk
id** — the same constraints as `ScopeMissEvent`, for the same reasons (minors' data; a public repo;
cross-tenant linkage in a third party's store). So triage cannot answer "who" or "which athlete"
from Sentry, by design. If you need to, the answer is in Postgres:

```sql
-- Which accounts are MEMBERS rather than owners, and so would get this refusal.
SELECT household_id, role, created_at
  FROM household_members
 WHERE deleted_at IS NULL AND role <> 'owner'
 ORDER BY created_at DESC;
```

**Remedies, in order of likelihood:**

1. **It is the expected refusal** — a member tried, the server said no, the data is untouched. The
   refusal IS the system working. Nothing to do.
2. **The member should be an owner.** There is no in-app role change until `INVITE-1`; today that is
   a data correction, and it is a **privileged** one — promoting an account to owner grants archive
   over every athlete in the household. Treat it as such.
3. **Repeated events with no plausible explanation** → treat as probing. The data is safe
   (the predicate matched 0 rows), so this is an investigation, not an incident.

   ⚠️ It should be unreachable: `uq_household_members_clerk_user` is partial-unique on
   `clerk_user_id` alone, so the second row cannot be inserted. If this alert fires, that constraint
   is missing or was dropped — check it before treating the rows. Do **not** "fix" the resolver by
   reading `rows[0]`: picking one is the silent cross-wire the throw exists to prevent, and a state-C
   fallback to "the one live household" would reinstate exactly the widening 1c-4 removed.

⚠️ **Rate limiting is not wired for this.** `apps/web/lib/rate-limit.ts` deliberately does not limit
the mutating actions; AUTH-1 re-keys the limiter from IP to user id and is where probing gets
throttled. Until then this alert is the consumer.

## Cut a Neon RESTORE branch before a destructive/backfill migration (rollback prep)

Before a destructive step (a backfill, a household deletion, the fresh start): in the Neon console,
**production project → Branches → New branch**, from the default branch at **now**, with **no compute
attached**. Readable by the project's members only. Record its name and an expiry date (7 days) in the
ledger, **never in git**.

- **Never attach compute to it while the destructive step's sitting is open**: it holds the same
  database name and rows as production, so it passes every gate a correction has.
- **Delete it on its expiry date**, and record the deleted date. Delete the ledger entry once Neon's
  point-in-time window has also passed the apply date (§ "The deletion ledger").

⚠️ _Unverified against Neon's current docs:_ that a branch with no compute can be restored from, and
the console's exact labels. R1's PR cites the page it relied on before merge.

## Promote `e2e` to a required check (branch protection)

_TODO — the repo-admin branch-protection change to make the `e2e` check required (the PR-28 milestone);
the `ci-skip-e2e` label + auto-skip already keep it green for irrelevant/docs PRs._

## Recover prod after a bad migration / restore from a Neon branch

**Restore** with Neon's operation that resets the default branch onto the restore branch (it keeps the
connection strings). **Everything written after the cut is lost.** While merges are frozen, no
migration journal reconcile is needed: the branch's `drizzle.__drizzle_migrations` is the same as
production's was at the cut, and nothing has migrated since. Check it after the restore:
`SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations;` equals the number of entries in
`packages/db/migrations/meta/_journal.json` on the frozen `main`.

🔴 **After the fresh start's step 7, never restore to a point before its step 3** (§ "The fresh start").

⚠️ _Unverified against Neon's current docs:_ the reset operation's name and what it keeps. R1's PR
cites the page before merge.

## First-time environment setup (Neon + Vercel + secrets)

_See [deploy.md](./deploy.md) — the one-time Neon/Vercel/secret wiring lives there._ The **procedure**
for splitting the Preview scope off production, with its confirmations, is the OPS-1 entry above; the
per-scope **values** live in `deploy.md`, which is where that pointer already sends you.

## Verifying V1-14a hardening after wiring the credentials

Neither system can be verified without live credentials, so this is the manual pass to run **once**
after setting the Vercel env. Until then both features no-op by design and the app behaves exactly as
it did pre-V1-14a — that absence path is what CI and local dev exercise.

### 1. Sentry is receiving — and is NOT leaking

1. Set `SENTRY_DSN` in Vercel (all three environments) and redeploy.
2. Trigger a real server error on the **preview** URL. Point the Preview scope's `DATABASE_URL` at a
   **valid-shaped but unreachable** host whose database name still contains `preview` — e.g.
   `postgres://u:p@127.0.0.1:1/mat_plan_preview` — load Today, then revert. The page should render
   `error.tsx` as before.
   ⚠️ **Not just "a bad host" any more (OPS-1).** A host whose database name lacks `preview` now
   fails `lib/env.ts`'s guard at **build** time, so there would be no page to load and no
   `error.tsx` to inspect. The string above passes boot validation and fails at connect, which is
   exactly the shape this step wants.
3. In Sentry, open the new issue and confirm **all** of:
   - it arrived at all (the DSN is wired);
   - **no `mp_gate` cookie** anywhere in the event — check Request → Headers and Request → Cookies;
   - **no `server_action_form_data.*`** entries under Additional Data;
   - **no request body** (Request → Data) and **no local variables** on any stack frame (Sentry 11
     collects both by default; `SENTRY_DATA_COLLECTION` turns them off);
   - no bodyweight value anywhere in the payload;
   - **no athlete UUID** in the request URL, the transaction name or `contexts.nextjs` (each shows
     `:id`); only a scope-miss event carries one, under `contexts.scope_miss`.
     If any of those appear, `lib/sentry-scrub.ts` is not running — treat it as a **security incident**,
     revoke the DSN, and rotate `CLERK_SECRET_KEY` (§ "Rotate a secret"). ⚠️ Said "rotate
     `ACCESS_GATE_PASSWORD`" until `AUTH-1` 1d; the credential a leaked payload would expose is now a
     Clerk session cookie, so the key that invalidates sessions is the one to rotate.

### 2. The mutation rate limit is enforcing

🔴 **Rewritten at `AUTH-1` 1d: the subject of this procedure was deleted.** It verified the GATE's
limiter by submitting a wrong access code 11 times and watching for "Too many attempts." There is no
code, no form and no IP-keyed limiter. The surviving limiter is `MUTATION_RATE_LIMIT` — 120 writes
per 5 minutes, keyed on the signed-in Clerk user id.

1. Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel and redeploy.
2. ⚠️ **This one cannot be checked by hand**, and that is a real difference from the gate's: 120
   writes in 5 minutes is not something a person does on a phone. Exercise it from a script against a
   **preview** deployment, or accept it as unverified in production and say so.
3. The refusal copy is `RATE_LIMITED` (`lib/constants.ts`), returned in the action's envelope — **not**
   an error page. An error page means the limiter is throwing instead of returning.
4. Sanity-check the fail-open path: temporarily set a bogus `UPSTASH_REDIS_REST_TOKEN`. Logging must
   still **work** (fail-open, by design — a Redis outage must not stop a kid logging), and Sentry
   should receive **one** `rate limiter unavailable` event per server instance, tagged
   `rate_limit_outcome: limiter_unavailable` and `limiter: mutation` (no id), plus a `rate-limit`
   breadcrumb on every such request. ⚠️ That event is the ONLY signal of a permanently dead limiter:
   a request it let through succeeds, so a breadcrumb alone would never be sent. One event means at
   least one failure on that instance (a single slow call counts); a limiter that is really dead shows
   as an event from every fresh instance.
5. **The zip export has its own limit** (`checkExportLimit`, `mat-plan:export`); a dead or timing-out
   limiter raises the same event with `limiter: export`, once per server instance. What is limited: `.github/SECURITY.md` → Rate
   limiting.

### 3. Confirm CI is unaffected

CI deliberately has **no** Upstash or Sentry credentials — no external service may gate a build. If a
CI failure ever mentions either, something has been added to GitHub Actions secrets that should not be.

---

## Delete a household and everyone in it (PRIV-1)

**When:** a household asks to be deleted, or the beta ends and you are clearing up.
[privacy/notice.md](./privacy/notice.md) → "Deleting your data" is what was promised; this is how it
is kept.

**Why manual:** the app has **no delete path at any level** — not for an entry, not for a profile, not
for a household. Beta 1 makes this self-serve behind step-up; `PRIV-3` makes it a guarded script.
Until then it is typed by hand, which is why every guard below is written out rather than assumed.

> ⚠️ **This is the most destructive procedure in the repo and it is irreversible by design.** Read
> both preconditions before you open a SQL editor.

### ⛔ Precondition 1 — verify the requester through the invitation channel

⚠️ **Updated at `AUTH-1` 1d: Beta 0 now HAS per-person identity** — signing in with your own Google
account is the only way in. The procedure below does **not** change, because a signed-in session still
does not prove that the person asking for an irreversible deletion is entitled to ask for it, and
nothing in the app records who requested what. Confirm the request through **the channel the invitation went out
on** — the same thread or address — or against a word agreed at invite time. **Never act on whatever
address the request arrived from**: that is how one adult gets another family's data destroyed, and
how a training log disappears from a dispute it was evidence in.

Then:

- **Tell the household on that same channel that the deletion is scheduled, and give them a date and a
  way to cancel.** A cooling-off window only defends against a fraudulent request if the real owner
  hears about it in time to stop it; without the notice it just buys the operator second thoughts.
- **Wait 7 days.** Then, **immediately before the transaction, re-confirm on the verified channel** —
  a request rescinded on day 3 must not still be applied on day 7.
- **Cut a Neon restore branch immediately before applying**, hold it **7 days after the apply** (its
  own window — the cooling-off one has already elapsed by then), then **delete it and record the date
  in the ledger.** Deleting it is a required close-out, not a ledger field: left alone, the default
  outcome is a branch nobody ever removes.

> ⚠️ **Do not treat that branch as a safety net.** It is a copy-on-write copy of the **whole
> database** — every household, with its own endpoint — and restoring from it would roll back every
> other family's writes and resurrect their previously-deleted rows. Extracting **one** household from
> it is `OPS-3`, whose runbook section is still a `_TODO_` stub below. **So until `OPS-3` exists and
> has been rehearsed once, a mistaken or fraudulent deletion is not practically recoverable.** That is
> a reason to be slow and careful at step 0 — not a reason to relax there. **`OPS-3`'s rehearsal is a
> precondition of the first real deletion of an outside family's data** (the maintainer's own family's does
> not wait for the drill, _maintainer, 2026-11-18_, Q7; its pause, re-confirmation and restore branch
> still apply).

### ⛔ Precondition 2 — a household with a seed id is not deleted here

Refuse if the household's `public_id` is in `SEED_PUBLIC_IDS`: the seeded household is removed by
`CAT-3`'s fresh start, not by this procedure. See ["A household or athlete with a seed id
(`OPS-2`)"](#a-household-or-athlete-with-a-seed-id-ops-2) for why (older seed code can re-create it)
and the check that goes with it. A household created through the app is not in the seed and is
unaffected; since `OPS-2` PR 1 production's seed writes no household at all.

### Steps

**0. Record the request.** In the deletion ledger (below), before anything else.

**0b. Record the household's Clerk user ids — before the transaction.** After `AUTH-1` the
Clerk↔household mapping lives in exactly the rows step 4 destroys. If step 6 is interrupted or
forgotten you are left with orphan Clerk accounts — an email address and a Google identity — and
nothing in the database to find them by. Capture them now; the ledger is the recovery path.

**1. The household exports its own data, in the app, while it still has access.**
`/p/<profileId>/export` per athlete, **downloaded by the household's owner** (only an owner login gets
an export, since 2026-11-19). An adult who is not an owner may ask for the full copy of **their own**
data, on their own verified channel; a child's copy goes only to an owner's channel.

⚠️ **That export is a partial copy** — no readiness colours, no "how it felt" notes (check-ins are in
it since FAM-1 14b), no per-athlete prescribed targets
([data-inventory.md](./privacy/data-inventory.md) §6). The notice promises a full copy on request, so
**ask whether they want one**, and if they do, produce it by hand **before step 4**, **including
hidden rows** (`deleted_at IS NOT NULL`: a cleared weigh-in is one, and it is in no export). Handing
over a partial copy immediately before irreversible destruction is not keeping that promise.

**Deliver it through the channel that verified the request in step 0 — never to whatever address
asked.** That is the rule: the prohibition is on sending a minor's training history to an
unverified recipient, not on the operator producing an extract at all.

**2. Resolve the household by `public_id`** — never by name, never by internal `bigint` id (corrections
README rule 3). Confirm you are on the **production** database:

```sql
SELECT current_database(), inet_server_addr();
SELECT id, public_id, name FROM households WHERE public_id = :household_public_id;
```

**3. Dry run — count every table, and run the pre-flight integrity checks.**

```sql
-- Counts. NOTE: no `deleted_at IS NULL` anywhere — a soft-deleted leftover must be counted,
-- or the step-5 proof passes on a household that still holds rows.
WITH h AS (SELECT id FROM households WHERE public_id = :household_public_id),
     p AS (SELECT id FROM profiles WHERE household_id = (SELECT id FROM h)),
     b AS (SELECT id FROM program_blocks WHERE household_id = (SELECT id FROM h)),
     s AS (SELECT id FROM sessions WHERE profile_id IN (SELECT id FROM p)),
     e AS (SELECT id FROM entries WHERE profile_id IN (SELECT id FROM p))
SELECT 'profiles' t, count(*) FROM p
UNION ALL SELECT 'entries', count(*) FROM e
UNION ALL SELECT 'entry_sets', count(*) FROM entry_sets WHERE entry_id IN (SELECT id FROM e)
UNION ALL SELECT 'entry_set_quantities', count(*) FROM entry_set_quantities
  WHERE entry_set_id IN (SELECT id FROM entry_sets WHERE entry_id IN (SELECT id FROM e))
UNION ALL SELECT 'sessions', count(*) FROM s
UNION ALL SELECT 'supersets', count(*) FROM supersets WHERE session_id IN (SELECT id FROM s)
UNION ALL SELECT 'day_readiness', count(*) FROM day_readiness WHERE profile_id IN (SELECT id FROM p)
UNION ALL SELECT 'ramp_targets', count(*) FROM ramp_targets WHERE profile_id IN (SELECT id FROM p)
UNION ALL SELECT 'program_blocks', count(*) FROM b
UNION ALL SELECT 'prescriptions', count(*) FROM prescriptions WHERE block_id IN (SELECT id FROM b)
-- FAM-1 4a-i: the week template and the workouts, both scoped by block (no deleted_at filter here
-- either: a hidden slot or workout is still a row the delete must remove).
UNION ALL SELECT 'block_day_workouts', count(*) FROM block_day_workouts WHERE block_id IN (SELECT id FROM b)
UNION ALL SELECT 'workouts', count(*) FROM workouts WHERE block_id IN (SELECT id FROM b)
-- FAM-1 5: assignments whose athlete AND program are H's, and their weekdays; targets the same way.
-- The same predicates step 4 deletes by. A row straddling two households is counted by neither, and
-- pre-flights (a) and (h) find it first.
UNION ALL SELECT 'program_assignments', count(*) FROM program_assignments
  WHERE profile_id IN (SELECT id FROM p) AND block_id IN (SELECT id FROM b)
UNION ALL SELECT 'program_assignment_weekdays', count(*) FROM program_assignment_weekdays
  WHERE assignment_id IN (SELECT id FROM program_assignments
    WHERE profile_id IN (SELECT id FROM p) AND block_id IN (SELECT id FROM b))
UNION ALL SELECT 'prescription_targets', count(*) FROM prescription_targets
  WHERE profile_id IN (SELECT id FROM p) AND prescription_id IN
    (SELECT id FROM prescriptions WHERE block_id IN (SELECT id FROM b))
-- FAM-1 4b: a template prescription's typed targets, scoped through the prescription (no
-- deleted_at filter: a hidden quantity still refuses its prescription's delete).
UNION ALL SELECT 'prescription_quantities', count(*) FROM prescription_quantities
  WHERE prescription_id IN (SELECT id FROM prescriptions WHERE block_id IN (SELECT id FROM b))
-- TEN-2a: `movements` is no longer purely global. A row with `household_id = H` is free text THIS
-- household typed; a row with `household_id IS NULL` is seeded reference data owned by nobody and
-- must SURVIVE. Counted here because the counts are the proof, and step 5 has nothing to compare
-- against without it.
UNION ALL SELECT 'movements', count(*) FROM movements WHERE household_id = (SELECT id FROM h)
-- CAT-3 A1: a movement's equipment and muscles, scoped through H's own movements. Zero today (no
-- writer makes one for a household movement); a library movement's rows have household_id NULL on
-- their movement and must SURVIVE.
UNION ALL SELECT 'movement_equipment', count(*) FROM movement_equipment
  WHERE movement_id IN (SELECT id FROM movements WHERE household_id = (SELECT id FROM h))
UNION ALL SELECT 'movement_muscles', count(*) FROM movement_muscles
  WHERE movement_id IN (SELECT id FROM movements WHERE household_id = (SELECT id FROM h))
-- AUTH-1 1b: the 19th per-household table when it was added. Its FK to `households` is NO ACTION, so a live row here
-- aborts step 14 and rolls the whole transaction back. Counted for the same reason as `movements` —
-- the counts are the proof, and 4d has nothing to compare against without it.
UNION ALL SELECT 'household_members', count(*) FROM household_members
  WHERE household_id = (SELECT id FROM h);
```

**Pre-flight integrity — every one of these must return 0, or STOP.** `entries.session_id`,
`entries.superset_id`, `prescription_targets.prescription_id` and, since FAM-1 4a-ii,
`sessions.workout_id` and `entries.prescription_id` are **unscoped FKs, enforced by the
writers and not by the schema** (`schema.ts` says so above `supersets`). A stray cross-household row
either aborts the transaction half-way or makes this procedure delete a row about another family's
child:

```sql
-- (a) a prescription_target straddling households — BOTH directions (prescription ∈ H but
--       profile ∉ H, or profile ∈ H but prescription ∉ H). Step 8 deletes only a target whose
--       athlete AND prescription are H's, so it leaves this row, and the delete of the parent it
--       points into (step 9 or 12) aborts 23503. This pre-flight finds it first.
-- (b) an ENTRY belonging to a profile OUTSIDE H that references one of H's sessions
--       (entries.session_id is independent of entries.profile_id)
-- (c) an ENTRY belonging to a profile OUTSIDE H that references one of H's supersets:
--       FROM entries e
--       JOIN supersets s   ON s.id    = e.superset_id
--       JOIN sessions sess ON sess.id = s.session_id
--       WHERE sess.profile_id IN (SELECT id FROM p) AND e.profile_id NOT IN (SELECT id FROM p)
```

```sql
-- (d) TEN-2a: an ENTRY or a PRESCRIPTION of H referencing a movement owned by ANOTHER household.
--       `entries.movement_id` and `prescriptions.movement_id` are unscoped FKs too, and nothing in
--       the schema stops them crossing. Both directions, because both abort step 4:
--         H's row -> a movement with household_id NOT IN (NULL, H)  → step 11 misses it, and
--                                                                     DELETE FROM households aborts
--         ¬H's row -> a movement with household_id = H              → step 11 deletes a movement
--                                                                     another family's row needs
--       FROM entries e JOIN movements m ON m.id = e.movement_id
--       WHERE e.profile_id IN (SELECT id FROM p)
--         AND m.household_id IS NOT NULL AND m.household_id <> (SELECT id FROM h)
--       (and the mirror, plus the same pair over `prescriptions` joined through `b`)
```

```sql
-- (e) FAM-1 4a-i: a WORKOUT of ANOTHER household copied from one of H's workouts. Its pointer is
--       `ON DELETE SET NULL`, so step 9b would rewrite that household's row SILENTLY, and its
--       `copied_from_program_name` is H's typed text, which the delete would leave behind.
--       The writer refuses a cross-household copy, so a row here is a defect: STOP, and clear both
--       provenance columns on the other household's row with a correction before this procedure.
--       SELECT w.id FROM workouts w
--         JOIN program_blocks b  ON b.id  = w.block_id
--         JOIN workouts src      ON src.id = w.copied_from_workout_id
--         JOIN program_blocks sb ON sb.id = src.block_id
--        WHERE sb.household_id = (SELECT id FROM h) AND b.household_id <> sb.household_id
--       (`db:verify` proves this join finds a planted row, `verify/schema.ts` → FAM-1 4a-i; it runs on
--       PGlite, never on production, so THIS is the check against real rows.)
-- (f) FAM-1 4a-ii: a SESSION of ANOTHER household naming one of H's workouts. Step 9b would SET NULL
--       its `workout_id` silently, and its `workout_name` (H's typed text) would stay on another
--       family's child's session, and from step 14 in their export. Step 11b's writer refuses it:
--       `programBlockOfProfile` in the workout lookup, proved by `verify/day.ts` 4d and mutation
--       111. So a row here is a defect: STOP, and with a correction clear BOTH `workout_id` and `workout_name` on
--       that session (the pairing CHECK allows both NULL) before this procedure.
--       SELECT s.id FROM sessions s
--         JOIN profiles pr ON pr.id = s.profile_id
--         JOIN workouts w ON w.id = s.workout_id
--         JOIN program_blocks b ON b.id = w.block_id
--        WHERE b.household_id = (SELECT id FROM h) AND pr.household_id <> b.household_id
-- (g) FAM-1 4a-ii: an ENTRY of ANOTHER household naming one of H's prescriptions. Step 9 would SET
--       NULL its `prescription_id`, and its `prescribed_snapshot` (rendered from H's prescription) and
--       its superset's `prescription_group` (H's label) would stay. A defect for the same reason:
--       STOP, and with a correction clear `prescription_id`, `prescribed_snapshot` and the superset's
--       `prescription_group` on those rows; the decision is to keep none of H's text (A2 §8).
--       Step 11b's writer refuses it: the prescription must be in the workout it names, and the
--       workout in the profile's own household (`verify/day.ts` 6c and 4d, mutations 112 and 111).
--       SELECT e.id FROM entries e
--         JOIN profiles pr ON pr.id = e.profile_id
--         JOIN prescriptions x ON x.id = e.prescription_id
--         JOIN program_blocks b ON b.id = x.block_id
--        WHERE b.household_id = (SELECT id FROM h) AND pr.household_id <> b.household_id
--       (`db:verify` proves both joins find a planted row, `verify/schema.ts` → FAM-1 4a-ii.)
-- (h) FAM-1 5: an ASSIGNMENT whose athlete and program are in DIFFERENT households, either side in H.
--       Steps 9c/9d delete only an assignment whose athlete AND block are H's, so they leave this
--       row, and the delete of the parent it points into (step 10 or 12) aborts 23503. This
--       pre-flight finds it first.
--       STOP; with a correction hard-delete the stray assignment and its weekday rows (it is a row about
--       the other family's child, and no writer can make one: 6c refuses it). No deleted_at filter.
--       SELECT a.id FROM program_assignments a
--         JOIN profiles pr ON pr.id = a.profile_id
--         JOIN program_blocks b ON b.id = a.block_id
--        WHERE (pr.household_id = (SELECT id FROM h) OR b.household_id = (SELECT id FROM h))
--          AND pr.household_id <> b.household_id
--       (`db:verify` → FAM-1 5 flags a planted one, hidden too.)
-- (i) FAM-1 12a: an ENTRY in a SESSION of ANOTHER profile (any household). The session's frozen
--       `workout_name` would reach that entry's athlete's day. No writer makes one: the row writer
--       creates or re-selects the session by `workoutSessionSlot(profile, day, workout)`. The day
--       resolver refuses it on the read side: its logged branch keeps a row only when
--       `entries.session_id IS NULL OR sessions.profile_id = the athlete`, proved by
--       `verify/day-plan.ts` → "FAM-1 12a (i)" and mutation 242. A row here is a defect: STOP, and
--       with a correction repoint or hide the entry before this procedure.
--       SELECT e.id FROM entries e JOIN sessions s ON s.id = e.session_id
--        WHERE s.profile_id <> e.profile_id
--       (`db:verify` proves this join finds a planted row, `verify/day-plan.ts` → FAM-1 12a (i).)
```

🔴 **Why (d) exists, and why it STAYS although `TEN-2c` closed the writer that minted it.** `TEN-2a`
wrote that global-first and the backfill rules prevent a (d) row _"by construction"_. **That was wrong,
and `TEN-2b` measured it:** while the non-partial `movements_slug_unique` lived, at most one row per
slug existed in the whole table, so two households could not both hold one — and when household B typed
a name household A typed first, `findOrCreateMovement`'s `23505` fallback handed B **A's row** (chosen
deliberately over failing B's write forever), so the entry B then wrote **was** a (d) row.

✅ **`TEN-2c` (migration `0017`) removed that mechanism.** The non-partial constraint is gone, B holds
its own row, and the fallback is unreachable, so **no new (d) row can be minted**. `db:verify` asserts
the consequence rather than the old hazard: this pre-flight reads **ZERO** across `entries` **and**
`prescriptions`, and step 11's `DELETE FROM movements` **completes** instead of aborting `23503` — both
assertions **inverted rather than retired**, through one shared definition of _referenced_
(`packages/db/src/queries/movement-ownership.ts`), which is also what the pre-2c hand-written check
missed: it covered `entries` and not `prescriptions`.

⚠️ **So (d) is still load-bearing — for the STOCK, not the flow.** Three reasons it stays: any reference
the fallback **already** minted is real data and outlives the code path; `db:verify` runs on PGlite and
never against production; and **`TEN-2c-1`'s split backfill creates (d)-shaped work on purpose** (the
clone-and-repoint below is that split performed by hand). Measure it, do not assume it — the
report-only correction `movements-ownership-2026-10-11` (`pnpm --filter @mat-plan/db db:correct`) prints
this exact count against production, as aggregate counts only. ✅ **It read ZERO on 2026-10-13** (the
`TEN-2d` census: 0 `entries`, 0 `prescriptions`), so this pre-flight has nothing to repair today —
⚠️ **a dated zero, not an invariant.** `packages/db/src/schema.ts` → the `movements` docblock says the
same. Nothing enforces it in the database.

⚠️ **What to do on a non-zero (d) — because "do not proceed" is not an answer here.** The row is
legitimate app data, not corruption, so it cannot simply be deleted:

- **¬H's rows pointing at a movement owned by H** (the second direction): **repoint them**, inside the
  step-4 transaction and before step 11, to a ¬H-owned clone of that movement — a fresh `newId()`
  `public_id`, the same `slug`/`name`, `household_id` = that household. This is `TEN-2c-1`'s split
  performed by hand for one row; **`TEN-2c-1`** automates it (it was `TEN-2c`'s until the split moved
  to its own row). ⚠️ The clone carries the **other** household's free text as `name` — see
  [data-inventory.md](./privacy/data-inventory.md) §4.
- **H's rows pointing at a movement owned by ¬H** (the first direction): nothing to do — step 11 does
  not select that movement and must not. H's entries go at step 3; the foreign movement survives,
  correctly.
- ⛔ **Never `UPDATE movements SET household_id = NULL`** to clear the block. See step 11.

With one household the count is zero by arithmetic. ✅ **`TEN-2d` — the arc's only mechanical
production-side gate, the row that `VALIDATE`d `movements_global_row_has_pattern` and deleted the
`23505` fallback — landed 2026-10-13**, so it is no longer an outstanding invite precondition; the
invite now waits on `AUTH-1` and the self-serve step ([beta-1](./milestones/beta-1.md)), plus
`TEN-2c-1`'s pre-invite re-measure. (`TEN-2c` closed the window that minted these rows; it did not make
a live database clean — which is why this repair step stays.)

⚠️ **(c) is the direction that actually exists.** `supersets` has no profile column — it is
household-scoped by construction through its session — so "a superset owned by an outside profile" is
not a row that can exist. The reachable defect is the inverse: an **entry** from outside H pointing at
one of H's supersets. Checking the impossible direction instead would leave exactly the
mid-transaction abort that step 3 exists to pre-empt.

Write them all out against the same CTEs and read the numbers. (a)–(c) and (e)–(i) must be zero. For
(d), follow the repoint above rather than stopping; for (e)–(i), STOP and clear the other household's
copies of H's text (or, for (h), the stray assignment; for (i), the stray entry) with a correction
first, as each says.

**4. Apply — one explicit transaction, and re-check inside it.**

⚠️ **This procedure creates its own write window between steps 3 and 4**: step 1 has the household
using the app, and precondition 1 adds a 7-day pause. ⚠️ **`1d` changed the reason but not the
window:** per-person revocation now exists (remove the `household_members` row), so the operator CAN
close the window for one person — but not for the household being deleted without locking out the very
people who may still want to cancel. So step 3's
numbers are stale by construction, and re-checking inside the transaction is the only mechanism
available.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 4a. Re-run step 3's PRE-FLIGHT INTEGRITY checks, here, inside the transaction.
--     Any non-zero → ROLLBACK: a cross-household row may have landed since step 3.
-- 4b. Re-run step 3's COUNT block. Numbers may be HIGHER than step 3 — the household kept
--     logging, which is expected. Anything that looks wrong → ROLLBACK.
-- 4c. The 21 DELETEs, in the order below, against the same CTE shape.
-- 4d. Re-run the COUNT block once more. Every row must read 0.

COMMIT;   -- or ROLLBACK, if 4a was non-zero or any number surprised you
```

A `40P01` (a deadlock with an app write on the same athlete) has rolled the whole transaction back;
re-run it from `BEGIN`. `PRIV-3` 2a's core (`src/erasure/erase.ts`, used from 2b) locks programs
before athletes, the program writers' order, so it cannot deadlock with them (except on a program
created while it runs); it can still deadlock with a log write (which takes the session before the athlete), or hit its `lock_timeout`. Postgres
aborts one side; if it is the erasure, re-run from the dry run.

**The order is child-before-parent and is not arbitrary.** `entries` carries FKs to **both**
`sessions` and `supersets`, so it must precede both — the non-obvious one, confirmed against
`packages/db/src/schema.ts` by two independent reviews. The same list is code in
[`packages/db/src/erasure/graph.ts`](../packages/db/src/erasure/graph.ts) (`HOUSEHOLD_GRAPH`, rows
1-21 in this order), which `db:verify` holds against the catalog:

| #   | Table                         | Scoped by                                                                                 |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `entry_set_quantities`        | `entry_set_id` ∈ entry_sets of entries of H                                               |
| 2   | `entry_sets`                  | `entry_id` ∈ entries of H                                                                 |
| 3   | **`entries`**                 | `profile_id` ∈ H — **before 4 and 5**                                                     |
| 4   | `supersets`                   | `session_id` ∈ sessions of H                                                              |
| 5   | `sessions`                    | `profile_id` ∈ H                                                                          |
| 6   | `day_readiness`               | `profile_id` ∈ H                                                                          |
| 7   | `ramp_targets`                | `profile_id` ∈ H                                                                          |
| 8   | `prescription_targets`        | `profile_id` ∈ H **AND** `prescription_id` ∈ prescriptions of H                           |
| 8a  | `prescription_quantities`     | `prescription_id` ∈ prescriptions of H — **FAM-1 4b; before 9**                           |
| 9   | `prescriptions`               | `block_id` ∈ program_blocks of H                                                          |
| 9a  | `block_day_workouts`          | `block_id` ∈ program_blocks of H — **FAM-1 4a-i; before 9b**                              |
| 9b  | `workouts`                    | `block_id` ∈ program_blocks of H — **FAM-1 4a-i; before 10**                              |
| 9c  | `program_assignment_weekdays` | `assignment_id` ∈ 9d's set — **FAM-1 5; before 9d**                                       |
| 9d  | `program_assignments`         | `profile_id` ∈ H **AND** `block_id` ∈ program_blocks of H — **FAM-1 5; before 10 and 12** |
| 10  | `program_blocks`              | `household_id` = H                                                                        |
| 10a | `movement_equipment`          | `movement_id` ∈ movements of H — **CAT-3 A1; before 11**                                  |
| 10b | `movement_muscles`            | `movement_id` ∈ movements of H — **CAT-3 A1; before 11**                                  |
| 11  | **`movements`**               | `household_id` = H — **TEN-2a; see below**                                                |
| 12  | `profiles`                    | `household_id` = H                                                                        |
| 13  | **`household_members`**       | `household_id` = H — **AUTH-1 1b; see below**                                             |
| 14  | `households`                  | `id` = H                                                                                  |

**Steps 8a, 9a–9d, 10a and 10b are lettered, not numbered**, so every "step 11" and "step 14" cited across the
repo still names the same table. A week slot references its workout through a composite FK, and a
workout references its block, both `NO ACTION`: out of order, the delete raises `23503` and the
transaction rolls back (`db:verify` proves both refusals and the order that commits). FAM-1 4b adds
two more `NO ACTION` edges, so step 8a precedes 9 and 9 precedes 9b: a prescription's quantity
refuses the prescription's delete (a **hidden** quantity too, which is why no step filters on
`deleted_at`), and a template prescription refuses its workout's, through the composite FK
`(workout_id, block_id)` (`db:verify` → FAM-1 4b proves both, and the order that commits). FAM-1 5
adds 9c and 9d: an assignment refuses both its block's delete (10) and its athlete's (12), and its
weekday rows refuse its own, all `NO ACTION`, hidden rows included (`db:verify` → FAM-1 5). ADR 0007
A2 §8 lists the assignment tables before `block_day_workouts` and `workouts`; no FK runs between them,
so 9c/9d after 9b is the same order and keeps every step number already cited.

Steps 1 and 2 are redundant with the `ON DELETE CASCADE` on `entry_sets.entry_id` and
`entry_set_quantities.entry_set_id` — written out anyway, because **the counts are the proof** and a
cascade reports nothing.

🔴 **Step 13 (`household_members`) is new at `AUTH-1 1b`, and without it this whole procedure aborts
the same way.** The FK `household_members.household_id → households.id` is `ON DELETE NO ACTION`
(drizzle's default), so a live membership makes step 14's `DELETE FROM households` raise `23503` and
**the whole transaction rolls back** — the household cannot be deleted at all, against
[notice.md](./privacy/notice.md)'s promise that the data is permanently removed. `docs/plan.md` →
`PRIV-3` predicted this class in writing: the `db:verify` proof is _"the only thing that catches a
**19th per-household table** escaping the runbook's hand-maintained delete order"_ — and
`household_members` **is** that 19th table.

⚠️ **`NO ACTION` rather than `ON DELETE CASCADE` is deliberate**, for the reason steps 1-2 already
give: a cascade reports nothing, and **the counts are the proof**. `db:verify` asserts that steps 13
then 14 **commit** and leave zero rows for H; it does not run this whole table. What it proves is the
graph in `packages/db/src/erasure/graph.ts` (`PRIV-3` P1 and P2): every per-household table is in it,
child before parent, and every foreign key that does not abort is accounted for. Rows 8 and 9d are
`AND` so that a row straddling two households is left and its parent's delete aborts `23503`, instead
of another family's row being deleted (pre-flights (a) and (h) refuse it first). This hand table is
replaced by the guarded script in `PRIV-3` PR 2b.

🔴 **Step 11 (`movements`) is new at `TEN-2a`, and without it this whole procedure aborts.** Migration
`0015` added `movements.household_id` with `ON DELETE NO ACTION`, so from the first non-NULL value the
final `DELETE FROM households` raises **`23503`** and strands the operator mid-procedure. Measured;
`NOT VALID` does **not** disarm it — `NOT VALID` skips the validation scan, it does not skip the
referential triggers. Step 11 must run **after 3 and 9** (`entries.movement_id` and
`prescriptions.movement_id` both reference it) and **before 12/13**.

```sql
DELETE FROM movements WHERE household_id = (SELECT id FROM h);
```

⚠️ **`household_id IS NULL` rows are NOT H's and must survive** — they are the seeded catalog, owned
by no household. The predicate is `household_id = H`, never `IS NULL OR = H`.

⛔ **Never "fix" an abort here with `ON DELETE SET NULL`, and never hand-type
`UPDATE movements SET household_id = NULL WHERE household_id = H`.** Either one promotes this
household's free text into the **global reference namespace**, where `TEN-2b`'s global-first resolver
then serves it to every other household — the opposite of a deletion. The correct response to a
blocked delete is always to **delete the rows**. `packages/db/src/schema.ts` and `0015`'s header both
say so; this is the step they are pointing at.

⚠️ **Residual, stated so nobody promises more than is true — and `TEN-2c` did NOT close it.** Two
shapes survive a deletion the notice describes as complete, and **`TEN-2c-1`** is what closes them:

1. **A row more than one household references** stays at `household_id IS NULL`. It carries H's typed
   `name`, is **not** selected by `household_id = H`, and therefore survives. (`TEN-2b` shipped **no
   backfill** — deliberately: assigning such a row to one household would, while the non-partial
   constraint lived, force every other household onto the fallback and so manufacture more (d) rows.
   `TEN-2c` dropped that constraint, which is what makes the split **legal**; the split itself is
   `TEN-2c-1`'s, done properly.)
2. **A pre-existing app-authored row nothing references** also sits at `household_id IS NULL` and is
   likewise unselected. Its removal is `TEN-2b-2` (the orphan correction).

Both are also the **read** leak's residual while they sit there: global-first serves a global row to
**every** household. `0017` only stops the set growing, via `movements_global_row_has_pattern`
(`VALIDATE`d by `TEN-2d`'s `0018`, 2026-10-13).

🔴 **And a third, which is this step's own failure mode:** if pre-flight (d) found a ¬H row pointing at
one of H's movements and it was **not** repointed, this `DELETE` raises **`23503`** and strands the
operator mid-procedure. ✅ **`db:verify` now asserts the `DELETE` COMPLETES** — the assertion was
`expectRejectedBy(entries_movement_id_movements_id_fk, …)` until `TEN-2c` inverted it — which proves
the **writer** can no longer produce such a row, **not** that a live database holds none. Do the
repoint in step 3 regardless.

One household today, so none of the three can arise yet; they become real at the invite. ✅
**`TEN-2d` landed 2026-10-13**, so the arc's mechanical gate is discharged and `TEN-2c-1` did not have
to precede it — the census of 2026-10-13 found **zero** rows of all three shapes (35 `movements` rows,
all global, all curated, none household-owned; 0 `TEN-2c-1` input, 0 `TEN-2b-2` input, 0 pre-flight
(d)). `TEN-2c-1` stays open as a **pre-invite re-measure**,
because a dated zero is not an invariant.

**`deleted_at` appears in no `WHERE`.** This is the documented inversion of corrections README rules 2
and 5: for a deletion, existence _is_ the guard, and soft-deleted rows are exactly what must go.

**5. Verify, after the commit.** Re-run the step-3 counts — **all zero, `movements` included** — and
then confirm the catalog's **seeded** rows are still there:

```sql
-- H owns nothing any more…
SELECT count(*) FROM movements WHERE household_id = :h_id;              -- must be 0
-- …and the global reference catalog survived (TEN-2a: `household_id IS NULL` = owned by nobody).
SELECT count(*) FROM movements WHERE household_id IS NULL;              -- must be > 0
-- …and so did the library's equipment and muscles (CAT-3 A1): each count must EQUAL the one read
-- before step 4. A 10a/10b typed with `OR household_id IS NULL` passes every check above and deletes
-- these, for every household. Zero until CAT-3 A2 seeds them.
SELECT count(*) FROM movement_equipment
  WHERE movement_id IN (SELECT id FROM movements WHERE household_id IS NULL);
SELECT count(*) FROM movement_muscles
  WHERE movement_id IN (SELECT id FROM movements WHERE household_id IS NULL);
```

Every FK except the two cascades and three `ON DELETE SET NULL` pointers is `NO ACTION`, so a table
this procedure missed would have aborted the transaction rather than silently orphaning rows; that is
a real safety property, not a hope. The three SET NULL pointers (`workouts.copied_from_workout_id`,
FAM-1 4a-i; `sessions.workout_id` and `entries.prescription_id`, 4a-ii) never fire inside this
procedure, because their child rows are deleted first (steps 3, 5, 9b); a cross-household one is
what pre-flight (e)–(g) catches, since SET NULL would rewrite it silently — and
`movements.household_id` is exactly that property firing, which is why step 11 exists.

**6. Delete the Clerk users** (once sign-in is switched on — chunk **1c**, not 1a). Clerk dashboard →
each user id recorded at step 0b → Delete user. The database delete does not touch Clerk. ⚠️ **`AUTH-1`
1a merged Clerk wired and DARK**, with no instance configured and no production keys, so there are
still no per-person accounts and this step is still a no-op: the shared gate password is **rotated**,
not deleted. It becomes live on the day the AUTH-1 checklist's first box is ticked.

**7. Close out.** Record completion in the ledger, delete the held restore branch once the 7-day
window has passed, and tell the household it is done — pointing them at
[notice.md](./privacy/notice.md) → "Deleting your data", which holds the **single** list of what
remains. Do not restate that list here; one list, one place.

### Safety

One explicit transaction, so a partial failure rolls back whole. Targeted by `public_id`. Idempotent
by nature — a second run finds nothing. Every FK into these tables is `NO ACTION` except five, each
named with its guard in `NON_ABORTING_EDGES` (`packages/db/src/erasure/graph.ts`): two cascades
(`entry_sets`, `entry_set_quantities`) and three `SET NULL` keys guarded by pre-flights (e), (f) and
(g). So a table this procedure missed aborts the transaction rather than silently orphaning rows.

**Blast radius is one household.** Steps 8 and 9d are the two predicates that name two parents, and
each requires both to be H's (`AND`). A row straddling two households is therefore left, the delete
of its parent aborts `23503`, and the whole transaction rolls back: it fails closed rather than
deleting another family's row. Pre-flights (a) and (h) find such a row before the transaction does.

### The deletion ledger

`OPS-3` needs this too, for per-household restores. **One ledger, not two** — a point-in-time restore
inside the window would otherwise quietly resurrect deleted rows, and replaying the ledger is what
makes a deletion stick.

**Where it lives: outside git, and outside the restorable database** — with the operational
credentials. It must not go in `docs/`, in the corrections **Applied** table, or anywhere else in this
repository: _"household X asked to be deleted on date Y"_ is personal data about an identifiable
household, and this repo is public and permanent.

| Field                            | Why                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| Request date                     | The clock for the 7-day window                                         |
| Household `public_id`            | The target, never a name                                               |
| **The channel that verified it** | Precondition 1's audit trail                                           |
| Clerk user ids (step 0b)         | Recovery if step 6 fails after the rows are gone                       |
| Apply date                       | What `OPS-3` replays against                                           |
| Restore-branch-deleted date      | Proof the held copy is gone                                            |
| Export outcome (fresh start)     | K15: the in-app export and full copy, each taken or declined at the go |
| Branch name and expiry           | Which held copy exists, and until when                                 |

**No names, no email bodies, no counts of a child's rows.** The invariant `OPS-3` must honour: a
per-household restore **replays this ledger before the data is served.**

⚠️ **The ledger is itself personal data, and it is the one new store this procedure creates.** A
household `public_id`, Clerk user ids and a contact channel are data about an identifiable family,
and the entry is a permanent record that **this household asked to be deleted** — which is precisely
the kind of thing someone asking to be deleted does not expect to be kept. It is held because
`OPS-3` cannot make a deletion survive a restore without it, and that is the only reason.

- **Retention: delete an entry once the restore window that made it necessary has passed** — i.e.
  once the held branch is deleted **and** the vendor point-in-time window has expired past the apply
  date. After that it is protecting against nothing. Keep only a dateless count if you want to know
  how many deletions have been run.
- Disclosed in [notice.md](./privacy/notice.md) → "Deleting your data" and listed in
  [data-inventory.md](./privacy/data-inventory.md) §8. It is not a secret kept from the household; it
  is a record held briefly on their behalf.

---

## Erase one athlete (FAM-1 step 5)

**When:** the household asks for one athlete's data to be removed, not the whole household's.
[privacy/notice.md](./privacy/notice.md) → "Deleting your data" promises it. **Manual until `PRIV-3`
scripts it**, as the household delete is; the guarded script is `PRIV-3`'s. Read
["Delete a household"](#delete-a-household-and-everyone-in-it-priv-1) first: this section reuses its
transaction shape and its ledger, and says only what differs.

### ⛔ Preconditions

1. **Who may ask** _(maintainer, 2026-11-16)_:
   - **the household owner**, confirmed on the invitation channel, exactly as the household delete's
     precondition 1; the household may cancel during the pause;
   - **an adult athlete, about their own profile.** Confirm on **their own** invitation channel (the
     one their membership was invited on), never on whatever address asked. Nothing in the database
     links a profile to a person, so the **owner confirms which profile is theirs**, and the profile must
     be `kind = 'adult'` (step 2). **The owner is told before anything happens, and cannot cancel**:
     only the adult can _(maintainer, 2026-11-16)_.

   Either way: the notice of a date and a way to cancel, the 7-day wait, the re-confirmation, and a
   Neon restore branch held 7 days, as the household delete. `OPS-3`'s rehearsal is a precondition of
   the first real erasure of an outside family's athlete, as it is of the first such deletion; the
   maintainer's own family's does not wait for the drill (Q7, 2026-11-18); its 7-day pause,
   re-confirmation and restore branch still apply.

2. **A seeded athlete is not erased here.** Refuse if the profile's `public_id` is in `SEED_PUBLIC_IDS`:
   it is removed with the seeded household by `CAT-3`'s fresh start. Production's seed no longer writes
   profiles (`OPS-2` PR 1), but older seed code could put one back; see ["A household or athlete with
   a seed id (`OPS-2`)"](#a-household-or-athlete-with-a-seed-id-ops-2). An athlete added in the app is
   unaffected.

### Steps

**0. Record the request** in the ledger (below). Erasing an athlete deletes no sign-in account. If an
adult athlete also asks for **their account** to go, delete their Clerk user as the household delete's
step 6 does (record its id at the ledger first); their `household_members` row is hidden by removing
the membership and keeps its `clerk_user_id` until the household goes.

**1. Offer the athlete's export first**, in the app (`/p/<profileId>/export`, which only the
household's owner can download), and the full copy on request, **including hidden rows**, delivered on the verified channel: the owner's for a child, **the
adult's own** for an adult athlete. Afterwards there is nothing to export.

**2. Resolve the athlete by `public_id`** on the **production** database, and assert their household and
kind:

```sql
SELECT current_database(), inet_server_addr();
SELECT id, household_id, kind, public_id FROM profiles WHERE public_id = :profile_public_id;
-- :P below is that id; :H its household_id. The household is the requester's; for an adult athlete
-- asking about themselves, kind = 'adult'.
```

**3. Dry run: counts, the pre-flights, and the report.** No `deleted_at` filter anywhere: a hidden row
is a row the erasure removes. `db:verify` reads this block and step 4's table, and fails unless both
name exactly `eraseAthlete`'s tables in its order.

```sql
SELECT 'entry_set_quantities' t, count(*) FROM entry_set_quantities
  WHERE entry_set_id IN (SELECT id FROM entry_sets WHERE entry_id IN (SELECT id FROM entries WHERE profile_id = :P))
UNION ALL SELECT 'entry_sets', count(*) FROM entry_sets WHERE entry_id IN (SELECT id FROM entries WHERE profile_id = :P)
UNION ALL SELECT 'entries', count(*) FROM entries WHERE profile_id = :P
UNION ALL SELECT 'supersets', count(*) FROM supersets WHERE session_id IN (SELECT id FROM sessions WHERE profile_id = :P)
UNION ALL SELECT 'sessions', count(*) FROM sessions WHERE profile_id = :P
UNION ALL SELECT 'day_readiness', count(*) FROM day_readiness WHERE profile_id = :P
UNION ALL SELECT 'ramp_targets', count(*) FROM ramp_targets WHERE profile_id = :P
UNION ALL SELECT 'prescription_targets', count(*) FROM prescription_targets WHERE profile_id = :P
UNION ALL SELECT 'program_assignment_weekdays', count(*) FROM program_assignment_weekdays
  WHERE assignment_id IN (SELECT id FROM program_assignments WHERE profile_id = :P)
UNION ALL SELECT 'program_assignments', count(*) FROM program_assignments WHERE profile_id = :P
UNION ALL SELECT 'profiles', count(*) FROM profiles WHERE id = :P;

-- PRE-FLIGHT 1 (must be 0): another athlete's entry in P's session or superset. The delete would abort
-- 23503 on it. On a non-zero, repoint or clear that pointer with a correction; NEVER delete the other
-- athlete's row to make this pass.
SELECT e.id FROM entries e
 WHERE e.profile_id <> :P
   AND (e.session_id IN (SELECT id FROM sessions WHERE profile_id = :P)
        OR e.superset_id IN (SELECT ss.id FROM supersets ss JOIN sessions s ON s.id = ss.session_id
                              WHERE s.profile_id = :P));

-- PRE-FLIGHT 2 (must be 0): P's rows on ANOTHER household's program: a target on its prescription, an
-- assignment to its block. The household delete's (a) and (h) stop on the same shape; no writer makes
-- one. STOP, and remove the stray row with a correction first (it ties P to another family's data).
SELECT t.id FROM prescription_targets t
  JOIN prescriptions x ON x.id = t.prescription_id JOIN program_blocks b ON b.id = x.block_id
 WHERE t.profile_id = :P AND b.household_id <> :H
UNION ALL
SELECT a.id FROM program_assignments a JOIN program_blocks b ON b.id = a.block_id
 WHERE a.profile_id = :P AND b.household_id <> :H;

-- REPORT (not a stop): this household's programs only P was ever on (every assignment row, open, closed
-- or hidden, is P's). Program text and targets belong to the household and stay, but one written for
-- this athlete alone can hold their prescribed loads and an instruction about them. List these to the
-- household on the verified channel at the START of the cooling-off and ask, for each: keep, or remove.
SELECT b.id, b.public_id FROM program_blocks b
 WHERE b.kind = 'template' AND b.household_id = :H
   AND EXISTS (SELECT 1 FROM program_assignments a WHERE a.block_id = b.id)
   AND NOT EXISTS (SELECT 1 FROM program_assignments a WHERE a.block_id = b.id AND a.profile_id <> :P);

-- REPORT, part 2 (not a stop): of the programs above, those with a workout COPIED into another program
-- (the app's copy-a-workout). The copy belongs to the program it was copied into and survives; removing
-- the source only clears the copy's link back. List these with the programs above and ask, for each:
-- keep, remove it and keep the copy, or remove both (removing the copy too is a second program).
-- :R is the list the first part returned.
SELECT src.block_id AS source_block, c.block_id AS copy_block, c.id AS copy_workout
  FROM workouts c JOIN workouts src ON src.id = c.copied_from_workout_id
 WHERE src.block_id = ANY(:R) AND NOT (c.block_id = ANY(:R));

-- REPORT, part 3 (not a stop): this household's OWN items (movements) that nothing would reference once
-- P is erased and any program removed above is gone. A name a household typed for one child (a drill
-- or a label about them) otherwise stays listed in that household's picker. List them and ask, for each:
-- keep, or remove. The app cannot remove an item, so a removal is a correction. :R2 is the list of
-- programs the household chose to remove (empty if none).
SELECT m.id, m.public_id FROM movements m
 WHERE m.household_id = :H
   AND (EXISTS (SELECT 1 FROM entries e WHERE e.movement_id = m.id AND e.profile_id = :P)
        OR EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id AND x.block_id = ANY(:R2)))
   AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.movement_id = m.id AND e.profile_id <> :P)
   AND NOT EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id
                    AND NOT (x.block_id = ANY(:R2)));
```

Part 3 lists only an item P's own rows (or a removed program) used, never one P never touched, so it
cannot offer up an item the household simply has not used yet.

(`prescription_targets` is deleted by its `profile_id = P` arm only: its other arm is the household's
prescriptions, which stay.)

**4. Apply — one transaction; re-run step 3's counts and both pre-flights inside it** (the cooling-off
made step 3's numbers stale), then the eleven DELETEs in this order, child before parent:

| #   | Table                         | Scoped by                                  |
| --- | ----------------------------- | ------------------------------------------ |
| 1   | `entry_set_quantities`        | `entry_set_id` ∈ entry_sets of P's entries |
| 2   | `entry_sets`                  | `entry_id` ∈ P's entries                   |
| 3   | `entries`                     | `profile_id` = P — before 4 and 5          |
| 4   | `supersets`                   | `session_id` ∈ P's sessions                |
| 5   | `sessions`                    | `profile_id` = P                           |
| 6   | `day_readiness`               | `profile_id` = P                           |
| 7   | `ramp_targets`                | `profile_id` = P                           |
| 8   | `prescription_targets`        | `profile_id` = P (this arm only)           |
| 9   | `program_assignment_weekdays` | `assignment_id` ∈ P's assignments          |
| 10  | `program_assignments`         | `profile_id` = P                           |
| 11  | `profiles`                    | `id` = P                                   |

**4b. Only if the household chose to remove a program only P was on**, and only for blocks with
`household_id = :H`. **Before step 10** (after it the report cannot be computed), re-run the report
inside the transaction and keep only blocks it still lists (a copy's program added by "Remove both", below, is exempt: it is checked by its own query). Lock them, and their workouts and prescriptions, first: `SELECT id FROM program_blocks WHERE id = ANY(:B) AND household_id = :H FOR UPDATE`, then the same `FOR UPDATE` on `workouts` and on `prescriptions` with `block_id = ANY(:B)`. An assignment's insert waits on the first, and a logged session's or entry's on the other two (their FK checks take `FOR KEY SHARE`, which `FOR UPDATE` blocks; the row writer locks no program row), so nothing the app writes can land between this check and the deletes. Then this must read 0, because nobody else
may have logged against those blocks without an assignment (doing someone else's workout creates none):

```sql
-- :B is the list of blocks to remove.
SELECT s.id FROM sessions s JOIN workouts w ON w.id = s.workout_id
 WHERE w.block_id = ANY(:B) AND s.profile_id <> :P              -- would be SET NULL silently
UNION ALL SELECT e.id FROM entries e JOIN prescriptions x ON x.id = e.prescription_id
 WHERE x.block_id = ANY(:B) AND e.profile_id <> :P              -- would be SET NULL silently
UNION ALL SELECT t.id FROM prescription_targets t JOIN prescriptions x ON x.id = t.prescription_id
 WHERE x.block_id = ANY(:B) AND t.profile_id <> :P;             -- would abort 23503

-- A copy elsewhere (report part 2). NOT a must-be-0: the household was asked at step 3. Compare this
-- list with their answer: a copy they did not know about (made during the cooling-off) is a new
-- question, so ASK again before removing that source; never skip it silently.
SELECT c.id FROM workouts c JOIN workouts src ON src.id = c.copied_from_workout_id
 WHERE src.block_id = ANY(:B) AND NOT (c.block_id = ANY(:B));   -- removing the source: SET NULL on the copy
```

On a non-zero from the first query, tell the household and skip that block (someone else trained on
it). On the copy list: remove the source only as the household answered. "Remove it and keep the copy"
leaves the copy whole, with its link back cleared. "Remove both" adds the copy's own program to `:B`,
after it passes the same checks **and this one**, which the first query cannot do (it looks for logs,
not assignments):

```sql
-- Other athletes assigned to a block in :B (open, closed or hidden). A STOP for that block: skip it, as
-- for one someone trained on. Which programs an athlete was on is THEIR record (notice.md, "What gets
-- logged"), so one athlete's erasure never removes it. Tell the household the copy's program stays, and
-- that the owner can ask for it separately (Remove one program, below).
SELECT a.id, a.profile_id, a.block_id FROM program_assignments a
 WHERE a.block_id = ANY(:B) AND a.profile_id <> :P;
```

So every block left in `:B` has assignment rows of P's only, and step 10 has removed them. Then, after
step 11, delete for those blocks: `prescription_targets` (a count that must read 0 by now) →
`prescription_quantities` → `prescriptions` → `block_day_workouts` → `workouts` → `program_blocks`,
counting each first and re-counting to 0. Before this check, an athlete assigned to the copy's program
who had never trained on it made `program_blocks`' delete abort `23503` (`program_assignments.block_id`
is `NO ACTION`), and the whole erasure rolled back.
`db:verify` → FAM-1 5 proves equivalent queries for the report's first part (this household only)
and for this pre-flight's first two queries together (`othersOnTheseBlocks` returns their union; the
split is which rows are a stop and which are a question). The assignment check above and report parts
2 and 3 are operator queries with no proof yet; `PRIV-3` PR 3 scripts them; this sub-order is the household delete's own (steps 8–10).

Then re-run step 3's counts: **every row reads 0**, and the household's other athletes' counts and its
program-table counts are unchanged. `COMMIT`, or `ROLLBACK` on any surprise; on a `40P01` (a deadlock with an app write), re-run the
transaction from the top. `db:verify` → FAM-1 5
runs step 4's order (`verify/schema.ts` → `eraseAthlete`, generated from the same list this section is
checked against) on an athlete with a row in every table, hidden rows included, beside a sibling whose
rows must come through unchanged, and fails when any table reachable from `profiles` by FK is not in
that list.

**5. Close out.** Ledger, the held restore branch, and tell the household it is done, pointing them at
[notice.md](./privacy/notice.md) → "Deleting your data", which holds the **single** list of what
remains. Do not restate it here.

### The ledger, at athlete grain

One ledger with the household delete. An athlete entry records: the request date, **the profile
`public_id`** (the target; `OPS-3`'s replay re-applies the erasure after a restore), the verifying
channel, the apply date, and the restore-branch-deleted date. **No Clerk ids**, unless the adult athlete
also asked for their account to go (step 0); no names. Retention as for a household entry.

---

## Remove one program, workout or typed item on request

**When:** the household asks for one program it built, one workout in such a program, or one item it
typed (a movement of its own) to be removed, and nothing else. The app can rename a program, and a
workout (since FAM-1 7b-ii), but delete neither, and it can neither rename nor delete a typed item, so FAM-1 7b-i's notice
sentence tells the household to ask. **Manual until `PRIV-3` scripts it** (PR 3b scripts the program
removal). Read ["Delete a household"](#delete-a-household-and-everyone-in-it-priv-1) first: this
section reuses its transaction shape, its pre-flights and its delete order, restricted to one program,
workout or item, and says only what differs.

### ⛔ Preconditions

The maintainer decided this section's policy on 2026-11-18 (Q7–Q10, relayed by the FAM-1 board), with a
principle that also binds any later in-app removal:

> _"we should not have one members change like this affect the others data in the long run - perhaps we
> could warn the adult/owner deleting that this may affect data and propose archiving or renaming it
> unless they are ok with changing the data and tell them who it affects. In the end, I would not want
> this to hurt eventual reporting"_ _(maintainer, 2026-11-18)_

1. **Who may ask:** the household owner, confirmed on the invitation channel, and re-confirmed once
   they have been told who is affected (step 3). **No pause** (Q8): the removal runs right after that
   confirmation, except where an adult athlete's copy is owed first (Q11, step 3). A Neon restore branch is cut immediately before it and **held 3 days**, then deleted.
   An adult athlete asking about a program written for them asks the owner, or asks for their own
   erasure ([Erase one athlete](#erase-one-athlete-fam-1-step-5)). `OPS-3`'s drill does not gate a
   removal from the maintainer's own family; it gates an outside family's (Q7).
2. **Only what the household built.** A program must be `kind = 'template'` with `household_id = H`; a
   `legacy` program belongs to the seeded household, which the fresh start erases whole (CAT-3 R0), so
   it is refused here. An item must have `household_id = H`; a row with `household_id IS NULL` is the
   shared catalog and is never removed this way.
3. **No `deleted_at` filter anywhere**, as in the household delete. A workout item taken out in the app,
   and a week slot taken off a day, are hidden, not gone, and their hidden rows are exactly what this
   removes. (No app path hides a program, a workout or an item.)
4. **Logged history survives.** A removal never deletes a log row and never leaves one
   without the name it shows: every session, entry and superset keeps the text frozen onto it when it
   was logged (`workout_name`, `movement_name`, `prescribed_snapshot`, `prescription_group`) and its set
   numbers; only the link back to the removed program, workout or prescription is cleared, so those logs no
   longer count toward the program in a per-program report (step 3 tells the requester). **A removal
   that would delete or orphan another athlete's log rows is refused**: that is why a typed item a log
   still names cannot be removed (STOP 2, Q10). The one exception: a typed item's name replaced on its logs on request
   (Q12, below).

### Steps

**0. Record the request** in the ledger (below).

**1. The export is offered at step 3**, once its list says who trained on it: the in-app export
(`/p/<profileId>/export`, downloaded by the household's owner) for each of them, and the full copy on
request. The in-app export holds no
program, no targets and no record of who was on which program, which is what a removal deletes.

**2. Resolve on the production database, by `public_id`.** `:H` comes from the **requester's**
household, never from the target row, and the target must carry it:

```sql
SELECT current_database(), inet_server_addr();
SELECT id FROM households WHERE public_id = :household_public_id;                          -- :H
SELECT id FROM program_blocks
 WHERE public_id = :block_public_id AND household_id = :H AND kind = 'template';          -- :B
SELECT w.id, w.block_id FROM workouts w JOIN program_blocks b ON b.id = w.block_id
 WHERE w.public_id = :workout_public_id AND b.household_id = :H AND b.kind = 'template';  -- :W, :B
SELECT id FROM movements WHERE public_id = :movement_public_id AND household_id = :H;     -- :M
```

No row is a refusal: the target is not this household's, or it is the seed's or the shared catalog's.

**3. Dry run: the stops, then say who is affected, and offer the alternative first.** Run the case's
stops first, and **tell the requester nothing until every stop reads 0**: a stray row of another
household would otherwise put another family's athlete in the list. Then run the report (below; its
queries are scoped to `:H`) and tell the requester, on the verified channel, **every athlete with an
assignment to it, a log naming it, or a target on it** (reports (1) and (2); for an item, STOP 2 and the
targets apply step 1 deletes), and what changes for them:

- their logs stay, with the names frozen onto them, but **no longer count toward the program in a
  per-program report**: a session's link to its workout, and an entry's to its prescription, is cleared;
- their record of being on the program, and their targets on it, are deleted.

Offer the export (step 1) to each athlete listed.

Then offer, as the default, the change that touches nobody's data:

| Target    | The alternative, offered first                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A program | Rename it, or take every athlete off it (the app's take off): it stays, and so does who was on it                                                     |
| A workout | Rename it, or take it off the week: it stays in the program, and its logs keep their link                                                             |
| An item   | Rename it, and if a log names it, have the name replaced on those logs too (below, Q12): the logs, sets and numbers stay; only the typed text changes |

**Remove only if the requester, told who, explicitly accepts changing those athletes' data.** If they
pick the alternative, a stop refuses, or they withdraw, nothing is removed, and **the ledger entry is
deleted then**. The one exception is a typed name replaced on its logs (Q12, below), whose entry is kept. An **adult** athlete
among those affected is told first, on their own channel, and cannot cancel it (Q9). **Before the apply
they are sent their own full copy**: their assignment rows and their targets on it, which the in-app
export does not hold. **The apply waits until they confirm they have it, and at most 3 days after it was
sent** (Q11; for a removal: a Q12 rename sends no copy, below); record the date sent and the date confirmed (or "not confirmed, 3 days") in the ledger. There is no in-app archive for a program, a workout or an item yet; when one is
built it is offered first, the same way.

**4. Apply** in one transaction; its **first statement after the `SET LOCAL`s locks the target** (below), so the app's
writers, which take `FOR NO KEY UPDATE` on a program before changing it, wait until `COMMIT`. Then
re-run the stops and the report (anything new since step 3, such as an athlete put on it, is a new answer
to get, never a row to delete silently), then count, delete and re-count to 0, `ROLLBACK` on any surprise. A `40P01` (a deadlock with an app
write) has rolled everything back: re-run the transaction from the top.

#### A program (`:B`)

```sql
-- STOP 1 (must be 0): rows of ANOTHER household on this program, the household delete's (a), (e),
-- (f), (g) and (h): a target or an assignment for a profile outside H, an entry of theirs logged
-- against its prescription, a copy of its workout in their program, or their session naming its
-- workout. No writer makes one. STOP, and clear the stray row with a correction first ((g)'s
-- correction clears the entry's prescription_id, prescribed_snapshot and its superset's
-- prescription_group, which are H's text).
SELECT 'target' k, t.id FROM prescription_targets t
  JOIN prescriptions x ON x.id = t.prescription_id JOIN profiles p ON p.id = t.profile_id
 WHERE x.block_id = :B AND p.household_id <> :H
UNION ALL SELECT 'assignment', a.id FROM program_assignments a JOIN profiles p ON p.id = a.profile_id
 WHERE a.block_id = :B AND p.household_id <> :H
UNION ALL SELECT 'entry', e.id FROM entries e
  JOIN prescriptions x ON x.id = e.prescription_id JOIN profiles p ON p.id = e.profile_id
 WHERE x.block_id = :B AND p.household_id <> :H
UNION ALL SELECT 'copy', c.id FROM workouts c
  JOIN workouts src ON src.id = c.copied_from_workout_id JOIN program_blocks cb ON cb.id = c.block_id
 WHERE src.block_id = :B AND cb.household_id <> :H
UNION ALL SELECT 'session', s.id FROM sessions s
  JOIN workouts w ON w.id = s.workout_id JOIN profiles p ON p.id = s.profile_id
 WHERE w.block_id = :B AND p.household_id <> :H;

-- REPORT (not a stop). Told to the requester at step 0, and removed only if the requester accepts
-- changing these athletes' data with it known.
-- (1) Who is on it, or was: every assignment row, open, closed or hidden. Removing the program takes
--     each athlete off it and removes the record of when they were on it (NO ACTION, so these rows are
--     deleted, never left). An ADULT athlete in this list is told on their own channel before the
--     removal, because that record is theirs (notice.md, "What gets logged"); they cannot cancel it.
SELECT a.profile_id, p.kind, a.active_from, a.active_to, a.deleted_at
  FROM program_assignments a JOIN profiles p ON p.id = a.profile_id
 WHERE a.block_id = :B AND p.household_id = :H;
-- (2) Who trained on it. Their logs STAY, and so does what was frozen onto them when they were logged:
--     the session's workout_name, each entry's movement_name and prescribed_snapshot (the targets as
--     prescribed, a child's load included), and the superset's prescription_group label. Only the link
--     back is cleared (SET NULL on sessions.workout_id and entries.prescription_id). Say so plainly:
--     removing that text from the logs is not this procedure; erasing the athlete is.
SELECT 'sessions' k, s.profile_id, count(*) FROM sessions s JOIN workouts w ON w.id = s.workout_id
  JOIN profiles p ON p.id = s.profile_id
 WHERE w.block_id = :B AND p.household_id = :H GROUP BY s.profile_id
UNION ALL
SELECT 'entries', e.profile_id, count(*) FROM entries e JOIN prescriptions x ON x.id = e.prescription_id
  JOIN profiles p ON p.id = e.profile_id
 WHERE x.block_id = :B AND p.household_id = :H GROUP BY e.profile_id;
-- (3) Its workouts copied into the household's OTHER programs. A copy is its program's, and stays
--     whole; its link back is cleared and it keeps the name of the program it came from
--     (copied_from_program_name). Ask, for each: keep it as is, clear that name, or remove the copy's
--     program too (a second removal, with its own stops and report).
SELECT c.id, c.block_id FROM workouts c JOIN workouts src ON src.id = c.copied_from_workout_id
 WHERE src.block_id = :B AND c.block_id <> :B;
-- (4) The household's own items only this program used: no other program and no log names them.
--     Ask, for each: keep, or remove (the typed-item case below, once the program is gone).
SELECT m.id, m.public_id FROM movements m
 WHERE m.household_id = :H
   AND EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id AND x.block_id = :B)
   AND NOT EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id AND x.block_id <> :B)
   AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.movement_id = m.id);
```

**Apply.** Lock first: `SELECT id FROM program_blocks WHERE id = :B AND household_id = :H AND kind =
'template' FOR UPDATE;` (one row, or `ROLLBACK`), then `SELECT id FROM workouts WHERE block_id = :B FOR UPDATE;` and `SELECT id FROM prescriptions WHERE block_id = :B FOR UPDATE;`. The first stops an assignment or a program edit; the other two stop a session or entry being logged against it (the row writer locks no program row, but each insert's FK check waits on these). A write that waited fails `23503` once this commits. Then, in the household delete's order (rows 8–10),
restricted to `:B`. Steps a and g keep the household delete's `AND` (rows 8 and 9d), so a row of another
household that landed after STOP 1 aborts `23503` instead of being deleted:

| Step | Table                         | Scoped by                                                                      |
| ---- | ----------------------------- | ------------------------------------------------------------------------------ |
| a    | `prescription_targets`        | `prescription_id` ∈ prescriptions of `:B` AND `profile_id` ∈ H                 |
| b    | `prescription_quantities`     | `prescription_id` ∈ prescriptions of `:B`                                      |
| c    | `prescriptions`               | `block_id` = `:B`                                                              |
| d    | `block_day_workouts`          | `block_id` = `:B`                                                              |
| e    | `workouts`                    | `block_id` = `:B`                                                              |
| f    | `program_assignment_weekdays` | `assignment_id` ∈ step g's assignments                                         |
| g    | `program_assignments`         | `block_id` = `:B` AND `profile_id` ∈ H                                         |
| h    | `program_blocks`              | `id` = `:B` AND `household_id` = `:H` AND `kind` = `'template'`: exactly 1 row |

Every FK in that list is `NO ACTION`, so an out-of-order step raises `23503` and the transaction rolls
back; the three `SET NULL` keys (report (2) and (3)) are the only rows outside the list that change. If
the household chose to clear a copy's name, with `:C` the report (3) `c.id` values they named: `UPDATE
workouts SET copied_from_program_name = NULL WHERE id = ANY(:C) AND copied_from_workout_id IS NULL`
after step e (the pairing CHECK allows a name with no link, not the reverse).

#### One workout (`:W` in `:B`)

The athletes on `:B` lose this workout from their week; tell the household who they are (report (1)
of the program case, read as "who is on the program it leaves").

```sql
-- STOP 1 (must be 0), narrowed to the workout. There is no assignment arm: an assignment is to the
-- program.
SELECT 'target' k, t.id FROM prescription_targets t
  JOIN prescriptions x ON x.id = t.prescription_id JOIN profiles p ON p.id = t.profile_id
 WHERE x.workout_id = :W AND p.household_id <> :H
UNION ALL SELECT 'entry', e.id FROM entries e
  JOIN prescriptions x ON x.id = e.prescription_id JOIN profiles p ON p.id = e.profile_id
 WHERE x.workout_id = :W AND p.household_id <> :H
UNION ALL SELECT 'copy', c.id FROM workouts c JOIN program_blocks cb ON cb.id = c.block_id
 WHERE c.copied_from_workout_id = :W AND cb.household_id <> :H
UNION ALL SELECT 'session', s.id FROM sessions s JOIN profiles p ON p.id = s.profile_id
 WHERE s.workout_id = :W AND p.household_id <> :H;

-- REPORT (2): who trained on it, and what stays on their logs (as the program case's (2)).
SELECT 'sessions' k, s.profile_id, count(*) FROM sessions s JOIN profiles p ON p.id = s.profile_id
 WHERE s.workout_id = :W AND p.household_id = :H GROUP BY s.profile_id
UNION ALL
SELECT 'entries', e.profile_id, count(*) FROM entries e JOIN prescriptions x ON x.id = e.prescription_id
  JOIN profiles p ON p.id = e.profile_id
 WHERE x.workout_id = :W AND p.household_id = :H GROUP BY e.profile_id;
-- REPORT (3): every copy of it, in this program or another (as the program case's (3)).
SELECT c.id, c.block_id FROM workouts c WHERE c.copied_from_workout_id = :W;
-- REPORT (4): the household's own items only this workout used. A legacy prescription's workout_id
-- is NULL, hence IS DISTINCT FROM rather than <>.
SELECT m.id, m.public_id FROM movements m
 WHERE m.household_id = :H
   AND EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id AND x.workout_id = :W)
   AND NOT EXISTS (SELECT 1 FROM prescriptions x WHERE x.movement_id = m.id
                    AND x.workout_id IS DISTINCT FROM :W)
   AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.movement_id = m.id);
```

**Apply.** Lock the program first, as above (the app's writers lock the program, not the workout),
then `SELECT id FROM workouts WHERE id = :W FOR UPDATE;` and `SELECT id FROM prescriptions WHERE
workout_id = :W FOR UPDATE;`, which stop a log against it, then:

| Step | Table                     | Scoped by                                                      |
| ---- | ------------------------- | -------------------------------------------------------------- |
| a    | `prescription_targets`    | `prescription_id` ∈ prescriptions of `:W` AND `profile_id` ∈ H |
| b    | `prescription_quantities` | `prescription_id` ∈ prescriptions of `:W`                      |
| c    | `prescriptions`           | `workout_id` = `:W` AND `block_id` = `:B`                      |
| d    | `block_day_workouts`      | `workout_id` = `:W` AND `block_id` = `:B`                      |
| e    | `workouts`                | `id` = `:W` AND `block_id` = `:B`: exactly 1 row               |

Removing its week slots leaves a gap in that weekday's `idx`, which is harmless: the reader orders by
`(weekday, idx)` (`queries/program/week.ts`) and the next `saveWeek` renumbers every slot from its
position. A program left with no workouts is still a program; removing it is the program case. A
device that later saves the removed workout gets the writer's `not_found` refusal
(`writers/program/save-workout.ts`), not a new row.

#### One typed item (`:M`, `household_id = :H`)

```sql
-- STOP 2 (must be 0): a LOG of this household names it. The item is the name those rows show, so it
-- cannot go while they stay. Live and hidden are counted apart: a row hidden by "Clear this day" is
-- kept hidden, not erased, and still names it. Tell the household which athletes, and that the item
-- stays; if the text itself must go, offer to replace it on those logs (below, Q12). Never delete or
-- repoint the logs to make this pass.
SELECT e.profile_id, (e.deleted_at IS NOT NULL) AS hidden, count(*) FROM entries e
  JOIN profiles p ON p.id = e.profile_id
 WHERE e.movement_id = :M AND p.household_id = :H GROUP BY 1, 2;
-- STOP 3 (must be 0): a LIVE workout item of this household names it. Ask the household to take it
-- out of those workouts in the app (which hides the row), or to have the workout removed; then re-run.
SELECT x.id, x.workout_id FROM prescriptions x JOIN program_blocks b ON b.id = x.block_id
 WHERE x.movement_id = :M AND b.household_id = :H AND x.deleted_at IS NULL;
-- STOP 4 (must be 0): ANOTHER household's rows on it, the household delete's (d) and (a)/(g) shapes:
-- their entry or prescription naming :M ((d): repoint it to a clone, as (d) says, never delete it),
-- or their target or entry on one of this household's hidden prescriptions of :M. No writer makes one.
SELECT 'entry' k, e.id FROM entries e JOIN profiles p ON p.id = e.profile_id
 WHERE e.movement_id = :M AND p.household_id <> :H
UNION ALL SELECT 'prescription', x.id FROM prescriptions x JOIN program_blocks b ON b.id = x.block_id
 WHERE x.movement_id = :M AND b.household_id <> :H
UNION ALL SELECT 'target', t.id FROM prescription_targets t
  JOIN prescriptions x ON x.id = t.prescription_id JOIN profiles p ON p.id = t.profile_id
 WHERE x.movement_id = :M AND p.household_id <> :H
UNION ALL SELECT 'logged-against', e.id FROM entries e
  JOIN prescriptions x ON x.id = e.prescription_id JOIN profiles p ON p.id = e.profile_id
 WHERE x.movement_id = :M AND p.household_id <> :H;
```

**Apply.** Lock first: `SELECT id FROM movements WHERE id = :M AND household_id = :H FOR UPDATE;`
(one row, or `ROLLBACK`). Re-run STOPs 2–4. Then count, delete and re-count to 0, each step scoped to
this household's rows:

1. `prescription_targets` for the hidden prescriptions of `:M` on H's programs, AND `profile_id` ∈ H;
2. `prescription_quantities`, then `prescriptions`, for those prescriptions (`movement_id = :M AND
block_id` ∈ H's programs). An entry logged against one keeps its set number and its frozen text,
   with its link cleared by `SET NULL`;
3. `movement_equipment`, then `movement_muscles`, with `movement_id` ∈ (`SELECT id FROM movements
WHERE id = :M AND household_id = :H`), never `:M` alone, so a mistyped id cannot touch the shared
   catalog's rows;
4. `movements` with `id = :M AND household_id = :H`: **exactly 1 row**, or `ROLLBACK`.

Never answer an abort here by setting `household_id` to NULL: that would publish the household's text
into the shared catalog (the household delete's step 11 says why).

#### A typed item's name, replaced on its logs (Q12)

When a log names the item (STOP 2 is not 0) and the household wants the **text** gone, for example a
person's name typed as an exercise, its name can be replaced on the item and on every one of the
household's own logs of it _(maintainer, 2026-11-18)_. The logs, sets and numbers stay; only the typed
name changes. It is the one exception to precondition 4: those logs' `movement_name` is rewritten.

**One item has many spellings.** A typed log keeps the text exactly as it was typed, and the item
matches it by slug, which ignores case and spacing (`writers/movement-catalog.ts`, the typed path,
`movementSlug` in `packages/shared/src/movements.ts`). So the replacement is keyed on the item, never on
one spelling:

- **Consent first:** step 3's list says whose logs change (STOP 2's athletes, live and hidden), and the
  requester accepts. An adult athlete among them is told on their own channel (Q9). No copy is sent and
  nothing waits for one: nothing of theirs is deleted, and a copy would carry the very text being
  removed.
- **The new name** is neutral, chosen by the requester, and never a person's name. Before the apply, run
  these checks from a fresh `origin/main` with the `packages/shared` functions the app uses, never by hand:
  - `typedMovementNameIssues(:new)` returns nothing, and `:new` equals its own trim;
  - `:new_slug` is `movementSlug(:new)`;
  - no near-twin: `existingItem` (`packages/shared/src/program/pieces.ts`, fed by `movementOptions` as
    `writers/program/new-item.ts` does) finds no row other than `:M` among the household's items, the
    catalog's names and its aliases ("Squats" next to "Squat" is refused, not only an exact slug).
    **No command runs this yet: `PRIV-3` PR 3b scripts it.** Until then, type the new name into the app's
    item picker for this household, without saving, and refuse any name it offers as an existing item.
- **psql history:** `:old` is the text being removed. Run this session with `PSQL_HISTFILE=/dev/null`,
  so it does not land in `~/.psql_history`.
- **Cut the restore branch first**, held 3 days, as for a removal.

**The stops (must be 0):** STOP 4 (another household's rows on it); the new slug already taken in this
household or the shared catalog, which `existingItem` alone cannot see for a catalog row outside the
picker (the second, slug-based step `newItem` takes for the same reason); and the same words in other
free text on this household's logs, which this does not rewrite. They are compared case-insensitively against every
spelling the item's logs hold:

```sql
SELECT count(*) FROM movements                                         -- must be 0
 WHERE slug = :new_slug AND (household_id = :H OR household_id IS NULL) AND id <> :M;

WITH spelling AS (
  SELECT DISTINCT lower(e.movement_name) AS s FROM entries e JOIN profiles p ON p.id = e.profile_id
   WHERE e.movement_id = :M AND p.household_id = :H
  UNION SELECT lower(name) FROM movements WHERE id = :M
)
SELECT 'superset' k, count(*) FROM supersets ss
  JOIN sessions s ON s.id = ss.session_id JOIN profiles p ON p.id = s.profile_id, spelling
 WHERE p.household_id = :H
   AND (strpos(lower(coalesce(ss.label, '')), spelling.s) > 0
        OR strpos(lower(coalesce(ss.note, '')), spelling.s) > 0
        OR strpos(lower(coalesce(ss.prescription_group, '')), spelling.s) > 0)
UNION ALL SELECT 'session', count(*) FROM sessions s JOIN profiles p ON p.id = s.profile_id, spelling
 WHERE p.household_id = :H
   AND (strpos(lower(coalesce(s.workout_name, '')), spelling.s) > 0
        OR strpos(lower(coalesce(s.feel, '')), spelling.s) > 0)
UNION ALL SELECT 'entry', count(*) FROM entries e JOIN profiles p ON p.id = e.profile_id, spelling
 WHERE p.household_id = :H
   AND (strpos(lower(coalesce(e.notes, '')), spelling.s) > 0
        OR strpos(lower(coalesce(e.context, '')), spelling.s) > 0
        OR strpos(lower(coalesce(e.scheme, '')), spelling.s) > 0
        OR strpos(lower(coalesce(e.value_text, '')), spelling.s) > 0)
UNION ALL SELECT 'readiness', count(*) FROM day_readiness r JOIN profiles p ON p.id = r.profile_id,
  spelling
 WHERE p.household_id = :H AND strpos(lower(coalesce(r.note, '')), spelling.s) > 0;
```

A non-zero count here is a new question for the maintainer, never a hand edit: the household typed those
words into a note or a label on a log itself. **Program text is not searched**: a program, workout or
item's name, notes or labels are the household's own words, which it can edit in the app; tell the
requester to check them.

**Apply**, in one transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(600001, hashint8(:H));   -- ADVISORY_LOCK.householdItems, as newItem takes it
SELECT id FROM movements WHERE id = :M AND household_id = :H FOR UPDATE;   -- exactly 1 row
-- re-run STOP 2's total and the stops above; then:
UPDATE movements SET name = :new, slug = :new_slug, updated_at = now()
 WHERE id = :M AND household_id = :H;                                     -- exactly 1 row
UPDATE entries e SET movement_name = :new, updated_at = now()
  FROM profiles p
 WHERE p.id = e.profile_id AND p.household_id = :H AND e.movement_id = :M; -- = STOP 2's total
SELECT count(*) FROM entries e JOIN profiles p ON p.id = e.profile_id
 WHERE p.household_id = :H AND e.movement_id = :M
   AND e.movement_name IS DISTINCT FROM :new;                             -- must be 0
COMMIT;
```

`ROLLBACK` on any count that differs. A `23505` means another row took the new name while this ran:
pick another and start again. A `40P01` is re-run from the top. **After `COMMIT`, run the last `SELECT`
again**: a log saved while the lock was held can land with the old spelling; if it is not 0, repeat the
`UPDATE entries` and the check.

**The ledger** keeps this entry (it is not deleted as an "alternative"): "name replaced: yes", **the new
name** (neutral by construction, so `OPS-3`'s replay can write it again after a restore), the count of
athletes whose logs changed, and the dates. **Never the old text.**

**Tell the household** that exports already downloaded, and the restore branch until it is deleted,
still hold the old name, and so does Neon's 6-hour point-in-time window (notice.md, "What remains
afterwards"). The app's next export shows the new one.

**5. Close out.** Ledger, the restore branch (deleted after 3 days), and tell the household it is done.

### The ledger, at item grain

One ledger with the household delete. An entry records the request date, **the `public_id`** of the
program, workout or item (`OPS-3`'s replay re-applies the removal after a restore), the verifying
channel, the household's keep-or-remove answer to report lines (3) and (4) **by the copy's or the
item's `public_id`**, `alternative offered: yes/no`, `accepted: yes/no`, `adult athletes told: a count and the date`, `copy sent` and `copy confirmed` dates (or "not
confirmed, 3 days"), and for a Q12 rename `name replaced: yes`, the new name and a count, the apply date and the restore-branch-deleted date. **Never who was on the program
or trained on it** (reports (1) and (2) are told, not answered): that is the record the removal deletes.
No names, no `profile_id`, no Clerk ids.

### What is proven, and what is not

The order is the household delete's (rows 8–10, 10a, 10b and 11), which `db:verify` proves at
household grain through `HOUSEHOLD_GRAPH` (`packages/db/src/erasure/graph.ts`). Nothing proves it at
one program, one workout or one item yet, and none of the queries above runs in `db:verify`: `PRIV-3`
scripts them and adds that proof. A replayed create of a removed program would make a new, empty one
when offline sync arrives (v1.5); the client id is not kept, so that is for v1.5's plan.

---

## AUTH-1 — the consent and dashboard checklist (PRIV-1 supplies it)

[beta-1.md](./milestones/beta-1.md) §3 says Clerk's dashboard settings "live nowhere in code, so they
go in a runbook checklist". This is that checklist's privacy half, written by `PRIV-1` so `AUTH-1` does
not have to invent it. `AUTH-1` owns the rest (the Google OAuth credentials, the domain, the
invite-only setting).

- [x] **The privacy-policy URL — answered 2026-10-21.** Point it at `/privacy` on the app's own
      domain; **`PRIV-2` landed** (#291), so the URL exists. It is set on the Clerk **Legal** page
      alongside the consent setting in the next box, not on Google's console.
      📌 **The verified-domain worry is a PRODUCTION-only question.** A **development** instance never
      touches Google's OAuth consent screen at all — Clerk's docs: _"For development instances, Clerk
      uses preconfigured shared OAuth credentials and redirect URIs — no other configuration is
      needed."_ So there is no Google console to read until the production instance is configured, and
      the original assumption (safe if wrong) still stands for that day.
      🔴 **That day arrived (2026-10-26), and Google has MOVED this console.** The single "OAuth
      consent screen" page this checklist described no longer exists; it is now **Google Auth
      Platform**, split four ways — and the paths matter because the boxes below point at them:

      | What you need | Where it is now |
      | --- | --- |
      | App name, support email, **authorized domains**, **privacy-policy URL** | **Branding** |
      | User type (External), **publishing status**, test users | **Audience** |
      | The scope list | **Data Access** |
      | The OAuth 2.0 client ids | **Clients** |

      ⚠️ **Publishing status is a real decision, not a formality** (**Audience**): *Testing* caps the
      app at **100 users**, each added by hand, and external users cannot sign in; *In production* is
      what Clerk's own docs require of a production instance. `userinfo.email` / `userinfo.profile`
      are **non-sensitive** scopes, so publishing does not trigger the long verification that
      sensitive scopes do.
      📌 **The Authorized JavaScript origin is the origin the BROWSER loads the app from**, which is
      not the redirect URI: the redirect goes to Clerk's own subdomain (`clerk.<domain>`), copied from
      Clerk so it cannot drift, while the origin is the app's. If both the apex and `www` resolve, add
      both — a mismatch fails silently.

- [ ] **A consent step at sign-up, before the first write. Two thirds answered 2026-10-21; the third
      is the one that matters and is deliberately still open.**
      ✅ **It exists and it is named** _"Require express consent to legal documents"_, on the Clerk
      dashboard's **Legal** page, with Terms-of-Service and Privacy-Policy URL fields beside it.
      ✅ **It needs no code here**: enabling it renders the checkbox inside the prebuilt `<SignUp />`
      and the Account Portal, and Clerk handles the acceptance flow. (A **custom** sign-up UI would
      have to handle it by hand — relevant only if 1c stops using the prebuilt component.)
      🔴 **Whether it BLOCKS sign-up until ticked is NOT stated by the docs.** Clerk's
      [changelog](https://clerk.com/changelog/2024-11-11-legal-consent) says users are _"required to
      accept your legal documents before they are allowed to create an account"_; the current
      [legal-compliance guide](https://clerk.com/docs/guides/secure/legal-compliance) describes only
      that a checkbox appears and never states the mechanism. A changelog entry from 2024 is not a
      behavioural guarantee at 7.9.15. **So test it, in the development instance, which is the whole
      reason to have one:** enable the setting, open `/sign-in`, attempt a Google sign-up **without**
      ticking the box, and record here what happened. If it does not block, `AUTH-1` adds an in-app
      consent step. Do not ship sign-in on the assumption that a vendor checkbox is doing this.
- [ ] **What records the consent.** Beta 0 has no account table and no consent column, so the
      **invitation is the record** — sign-up is invitation-only, so who was asked and when is known.
      Storing a consent timestamp is a Beta 1 item. Say which of these is true in the notice.
- [ ] **Update the notice before sign-in goes live**, not after: [notice.md](./privacy/notice.md) →
      "What is changing" currently describes Clerk and Google in the future tense, and the processor
      table in [data-inventory.md](./privacy/data-inventory.md) marks both "not wired".
- [ ] **Confirm the production `DATABASE_URL` carries an `sslmode` parameter.** `client.ts` upgrades
      one to `verify-full` but explicitly will not invent one, and nothing validates it — so TLS
      verification in production is an environment fact, not a code guarantee.

### The dashboard half — added by `AUTH-1` chunk 1a

1a merged with `@clerk/nextjs` **wired and dark**: both keys optional, no instance configured, nothing
sent to Clerk. Everything below is what has to be true **before an instance is pointed at production**.
Work it top to bottom with the console open; several boxes are one console read each and are owed as
`data-inventory.md` rows, not as opinions.

📌 **There is no separate "create a development instance" step, which is why this list never had one.**
Creating the application at [dashboard.clerk.com](https://dashboard.clerk.com) **is** creating the
development instance — an app is born with one and it is the default context. A **production** instance
is a later, explicit act from the instance dropdown, and the first box below is what says not to do it
yet. Navigation paths in this list are the dashboard's **current** ones (verified 2026-10-21); Clerk
moves them, so treat a path that does not resolve as a renamed page, not a missing feature.

- [x] ✅ **Production keys stay UNSET until chunk 1c — DISCHARGED 2026-10-29**, when `1c-3` made the
      session the boundary and the keys went into Vercel (Production scope; the publishable half as
      **Config**, not Secret — it is public by design and Vercel refuses the contradiction). Kept for
      the reasoning, which is still the reason not to light an instance early. This was about _not_ doing
      something, and it is the UX panel's finding, not a precaution: between 1a and 1c a completed
      Google sign-in granted nothing, landed on `APP_HOME_PATH`, and was bounced to `/gate` for the
      shared password — so the reward for signing in was a password prompt, with no explanation on
      screen. ✅ That shape is gone at `1d`: sign-in is the only door and lands on the picker. Use
      the **development** instance for everything in this list. The Clerk user id that chunk 1b's claim
      correction needs is read from **Clerk's own dashboard**, which is where the 1b box below already
      sends you; it does not require the app's `/sign-in` to be live in production.
- [x] ✅ **The production instance's custom domain — DONE 2026-10-29.** A production instance serves its Frontend API from
      `clerk.<domain>` and its Account Portal from `accounts.<domain>`; neither resolves until CNAMEs
      exist. The dashboard's **Configure → Domains** lists the full set — the mail/DKIM entries carry
      an instance id, so copy them rather than reconstruct them. The two that gate sign-in:

      | Host | Type | Target |
      | --- | --- | --- |
      | `clerk.<domain>` | CNAME | `frontend-api.clerk.services` |
      | `accounts.<domain>` | CNAME | `accounts.clerk.services` |

      ⚠️ **Set this up in the PRODUCTION instance.** The dashboard opens on **development**, where
      every page in this list renders plausibly — a Domains tab showing a `*.clerk.accounts.dev`
      primary badged _Development domain_ is the tell. The environment selector sits beside the
      application name.

      **Three diagnostics, because the failure modes are indistinguishable from the app side.** Each
      answers a different question and none requires the dashboard:

      | Symptom | Command | Reading |
      | --- | --- | --- |
      | clerk-js 404s, browser reports a CORS error | `dig +short zzz-nope.<domain> A` | A deliberately non-existent subdomain resolving means a **wildcard** is answering for `clerk.*` too, sending it to the app host — which 404s on an unknown hostname. A specific CNAME beats a wildcard, so add the records; the wildcard can stay. |
      | TLS `handshake failure`, no HTTP status | `curl -o /dev/null -w '%{http_code}' https://<frontend-api>/v1/client` on **both** instances | Development answering **200** while `clerk.<domain>` answers **000** is conclusive: Clerk is healthy, the custom hostname has no certificate. Not CSP, not CORS, not the key. |
      | Certificate seems stuck | `curl -s 'https://crt.sh/?q=clerk.<domain>&output=json'` | Empty means issuance has **never started** — the domain is unverified on Clerk's side, so waiting will not help. A result means it is in flight. |

      📌 The publishable key encodes the host Clerk expects: `base64 -d` the part after `pk_live_`.
      **A healthy result is `200` or `401`** — `401` means Clerk answered.

- [x] ✅ **Google only — verified on the PRODUCTION instance, 2026-10-29.** Every other sign-in strategy disabled, or invitation-only has a second door.
      **Path (verified 2026-10-21):** **SSO connections → Add connection → For all users → Google.**
      Disable email/password and every other strategy in the same pass; the point of the box is that
      invite-only governs one door only if there is one door.
- [x] **Sign-up restricted to invited emails.** 🔴 **The 2026-10-21 verification was on the
      DEVELOPMENT instance, and production stayed `Open` until 2026-10-29** — proven, not suspected:
      two accounts self-created from two Google addresses with no invitation, 20 minutes apart, while
      the checklist read as satisfied. **Access mode is per-instance, like everything else on this
      page.** Set to `Invite-only` on production 2026-10-29.
      🔴 **CHANGED AGAIN 2026-11-05: production is now `Waitlist`** _(maintainer)_, verified on the
      instance. The sign-in card gains "Want early access? Join waitlist", which leaves the app for
      `accounts.mat-plan.dev/waitlist` — Clerk's hosted page, no link to the notice.
      ⚠️ **This mode is load-bearing for published copy.** `docs/privacy/notice.md` and
      `SIGN_IN_COPY.invitation`/`.waitlist` describe it, and nothing in the repo can read the mode at
      runtime — so **changing it here means changing both in the same breath**, or the published
      notice becomes false. ⏳ Owed: the waitlist retention console read, which
      `data-inventory.md` §7 tracks. ✅ **It exists, it is called
      `Invite-only`** (API value `restricted`), on the **Access mode** page
      (`dashboard.clerk.com/~/user-authentication/access-mode`), one of three modes with `Open`
      (`public`) and `Waitlist` (`waitlist`). ✅ **It blocks**, per Clerk's
      [access-control docs](https://clerk.com/docs/guides/secure/restricting-access): _"The
      `<SignUp />` is accessible only to users who have been invited and have a valid invitation link.
      Users who don't have access will see a message indicating that they need an invitation to sign
      up."_ So the "no household #2" question does **not** re-open on this setting.
      🔴 **But there is no second layer, which this checklist assumed there might be.** Allowlist and
      blocklist **apply only in `Open` mode** — in `Invite-only` they do not apply at all, because
      sign-ups are already restricted. So this is **one** mechanism, not belt-and-braces, and a
      misconfiguration of it has no backstop. (Allowlist also needs a paid plan in production, so it
      was never the cheap fallback either.) The code-side exit criterion below is therefore load-bearing,
      not redundant. If it does not block, the "no household #2" question is re-opened before
      1c ships. 📌 **Which half is vendor and which is code:** account **creation** can only be held by
      the dashboard — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is public by design, so Clerk's Frontend API
      is reachable without going through this app and no code here can sit in front of sign-up. The
      exit criterion is narrower and **is** held in code: an uninvited Google account cannot create a
      **household**. Record the residual even if the setting works — an unrestricted instance **would
      mean** Clerk holds uninvited people's email addresses, which is a `data-inventory.md` §7
      re-review trigger, not merely an availability concern.
      ✅ **DISPOSITIONED 2026-11-05 (`AUTH-1` 1d).** The trigger fired and was checked: the production
      Users list holds **two accounts, both the maintainer's own Google accounts** — no third party's
      address is held. The §7 re-read is logged in `data-inventory.md`.
      🔴 **The past tense above is deliberate and was earned the hard way.** This sentence read
      _"an unrestricted instance means Clerk holds uninvited people's email addresses"_ in the
      **present** tense, with the disposition recorded nowhere — and **two independent readers** (the
      1d plan's author and its privacy lens) each reached the same false P0 straight from this text,
      one of them mid-panel. A conditional written as a fact is a finding generator. ⏳ **Still
      genuinely unobserved:** whether a refused sign-up leaves a Clerk user record at all — see the
      1d plan's lit-panel finding 5.
- [ ] **The production instance's own Google OAuth credentials**, development instance kept separate.
      ✅ **The separation is automatic, not a discipline to maintain** (verified 2026-10-21): a
      development instance uses _"preconfigured shared OAuth credentials and redirect URIs"_ of
      Clerk's, so it **cannot** use this app's credentials and no Google Cloud Console work exists for
      dev at all. This box is entirely a production-instance box; the custom-credentials toggle
      (**Use custom credentials**, with **Enable for sign-up and sign-in**) is where it is done.
- [x] 🔴 **The exact OAuth SCOPE list — CLOSED 2026-10-26 on the production instance.** The custom-credentials screen shows `openid` · `userinfo.email` · `userinfo.profile`, and **`userinfo.profile` could not be removed** — confirmed by the maintainer in the console, not inferred from docs. So `name` and `picture` arrive whatever this app wants, and the documents were edited in the chunk that configured the instance, exactly as the conditional below required. [notice.md](./privacy/notice.md) now says plainly what Google sends and that this app **reads and stores none of it**; [data-inventory.md](./privacy/data-inventory.md) §7 records the scope list and that it cannot be narrowed. The standing prohibition is unchanged and is now the load-bearing control: **nothing may ever write `profiles.avatar`.** ⚠️ Do not reintroduce a flat "Google sends us nothing but an email address" — it is false at the token and falsifiable by anyone who looks.

- [x] 🔴 **(superseded, kept for the reasoning) The exact OAuth SCOPE list — answered 2026-10-21, and the answer is NOT the one this box
      was hoping for. It is now a named obligation on the chunk that configures the instance, not an
      open question.**
      **What was read:** Clerk's default Google scopes are exactly the conventional
      **`openid email profile`**, and the dashboard's **Scopes** field _only appears when **Use custom
      credentials** is enabled_. Two consequences:
  1. **On a development instance the scopes cannot be narrowed at all**, because dev runs on Clerk's
     shared credentials and the custom-credentials toggle is what reveals the field.
  2. **Even on production, `profile` cannot be dropped.** Clerk pre-configures and automatically
     includes the essential scopes each provider needs to authenticate; the Scopes field **adds**
     scopes, it does not subtract them. So _"pinned to the minimum that signs a user in"_ **is**
     `openid email profile`, and this box's premise — that a narrower list exists to pin — is false.
     🔴 **Therefore `picture` arrives from Google whatever we do**, and the conditional in the
     original box (_"if `profile`/`picture` is unavoidable"_) has resolved to **unavoidable**. The
     documents are edited **in the chunk that configures the instance**, as that conditional already
     required: [notice.md](./privacy/notice.md)'s **"no photos"** claim and
     [data-inventory.md](./privacy/data-inventory.md) §7's pin to _"an email address and a Google
     account identifier"_ are both too narrow for what is **received**.
     📌 **The honest edit distinguishes RECEIVING a claim from STORING it**, which is a real and
     defensible distinction and the only one that makes the notice true without overstating the
     exposure: Clerk receives a name and a picture URL in the ID token; this app reads neither and
     persists neither. **Nothing may ever write `profiles.avatar` from Clerk** (§2 already flags that
     column: what it would hold is a picture of a child), and that prohibition is now the load-bearing
     control rather than a scope setting. ⚠️ Do **not** write "Google sends us nothing but an email
     address" — it is false at the token, and a privacy notice that is false in a checkable way is
     worse than one that is wordy.
- [x] **Clerk's data region:** US only; Clerk offers no region choice (its docs, read
      2026-11-16 for `SCALE-2`; recorded in [data-inventory.md](./privacy/data-inventory.md) §7).
- [x] **Sentry's data region** (`SCALE-2`): **US**, from the organisation's Data Storage Region
      setting (the maintainer's console read, 2026-11-16; recorded in
      [data-inventory.md](./privacy/data-inventory.md) §7). On a re-check: the host of production's
      `SENTRY_DSN` reads `…ingest.us.sentry.io` (US) or `…ingest.de.sentry.io` (EU); a host with
      neither segment needs the organisation settings.
- [x] **Vercel's function region** (`SCALE-2`): **`iad1` only**, shown as Overridden (the
      only override in the tree is `apps/web/vercel.json`), in the project dashboard's Function Regions (the maintainer's read,
      2026-11-16). The dashboard is the authority. ⚠️ An `x-vercel-id` header is only a cross-check,
      and only on a response a function served: a redirect or cached page shows one region segment,
      which is the EDGE, and from US East the edge is also `iad1`, so it proves nothing.
- [ ] **Each processor's data processing agreement** (`SCALE-2`): whether one is offered, which
      version applies and whether it was accepted. Proposed as owed before the first outside family
      (Beta 1); not yet a Beta 1 exit criterion.
- [ ] 🔴 **Clerk's retention** for user records and sign-in/session logs → a `data-inventory.md` §8 row.
      `beta-1.md`'s exit criterion requires the notice to ship **with no blanks**, so read it while the
      console is open for the free-tier box rather than adding a fourth "not confirmed".
- [x] **Telemetry — answered at 1a, in code.** `@clerk/nextjs@7.9.15` reads
      `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED` (`dist/esm/server/constants.js`) and
      `apps/web/next.config.ts` pins it on, so it holds for every build, `pnpm dev`, CI and preview
      without anyone remembering it. Keeping it off is also what keeps `clerk-telemetry.com` out of the
      CSP. **Re-check on every `@clerk/nextjs` bump.**
- [x] **Keyless auto-provisioning — answered at 1a, in code, and it mattered.** At the pinned version,
      `pnpm dev` with no publishable key would have taken Clerk's keyless path
      (`dist/esm/server/keyless-node.js` → `createAccountlessApplication`) and **provisioned a live
      Clerk application from a developer's machine** — a new processor relationship created by a dev
      server. `next.config.ts` pins `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED`, and `lib/clerk.ts`
      independently refuses to render `<ClerkProvider>` without both keys, so it is two locks.
- [x] **The `'use server'` grep — run at 1a, non-empty, and pinned by a test.**
      `grep -rl "use server" apps/web/node_modules/@clerk/nextjs/dist/esm` returns **two** modules:
      `app-router/server-actions.js` (`invalidateCacheAction`, which deletes a cookie named
      `__clerk_invalidate_cache_cookie_${Date.now()}` that by construction never exists — reads
      nothing, takes no arguments) and `app-router/keyless-actions.js` (`deleteKeylessAction`, inert
      because of the box above). Both are now reachable from every public page's module graph, because
      `<ClerkProvider>` is in the root layout. `app/pages-need-a-session.test.ts` asserts the set is
      **exactly those two**, so a bump that adds a third turns CI red. **Give a Clerk bump its own
      reviewed PR**, the treatment [SECURITY.md](../.github/SECURITY.md) already gives
      `claude-code-action` — not routine Dependabot noise.
- [x] **Clerk's CSP requirements — read at 1a and recorded.** Read off the pinned version's own
      `dist/esm/server/content-security-policy.js` (`DEFAULT_DIRECTIVES`), then narrowed to what this
      app uses: the instance's **Frontend API origin** in `connect-src` (derived from the publishable
      key, exact, never a wildcard), `https://img.clerk.com` in `img-src`,
      and `worker-src 'self' blob:`. ⚠️ `https://challenges.cloudflare.com` in `frame-src`
      was REMOVED at `1d` — see the bot-protection box below. **No host is
      added to `script-src`** — `'strict-dynamic'` makes browsers ignore host sources there, and Clerk's
      script loads on this app's existing per-request nonce instead (`<ClerkProvider nonce dynamic>`;
      the vendor's own type says the nonce "requires the `dynamic` prop to also be set"). Clerk's own
      recommended policy is **not** adopted: it carries `'unsafe-inline' https: http:` in `script-src`
      and two `*.protect.clerk.com` wildcards.
- [x] ✅ **`style-src` — CLOSED 2026-10-29: `clerk-js` DOES propagate our nonce, and production needs no change.** Production is
      `style-src 'self' 'nonce-…'`; Clerk's recommended policy is `'self' 'unsafe-inline'`, and under
      CSP3 a nonce makes `'unsafe-inline'` inert — so there is no "add it as well": relaxing
      `style-src` for Clerk means **deleting the nonce for the whole app, on every route**.
      🔴 **The trap, paid for on 2026-10-22:** `proxy.ts:71` is
      `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-…'`}` with
      `isDev = env.NODE_ENV === 'development'`, so **a `pnpm dev` run allows `'unsafe-inline'` and
      every JS-injected style passes trivially.** A clean console there says **nothing** about
      production. The first attempt at this box was made against `pnpm dev`, saw zero `style-src`
      violations, and proved nothing.
      ✅ **What that run DID establish, and it rules out one of the two failure shapes:** at
      `@clerk/ui@1.41.1` **no stylesheet is fetched at all** — every asset from Clerk's CDN is `.js`
      (`ui.browser.js`, `signin_ui_*.js`, …), and styles are injected from JavaScript. So there is no
      **host** to allowlist, and the only question left is the narrow one: **does `clerk-js`
      propagate the nonce we pass (`<ClerkProvider nonce dynamic>`, then `app/layout.tsx`; now `components/layout/clerk-root.tsx`) onto the
      `<style>` elements it creates?** If it does, production needs no change at all. If it does not,
      they are blocked under `'nonce-…'` and the card goes unstyled — losing contrast, focus-visible
      and every tap target at once.
      ✅ **Answered 2026-10-29 on the live production deployment** — a stronger reading than the
      `pnpm e2e:local` procedure this box planned, because it is the real build, the real nonce and
      the real `pk_live_` instance rather than a local approximation. `/sign-in` renders Clerk's card
      **fully styled** — the Google button, its border and type, and the "Secured by Clerk" footer —
      with **no `style-src` violation**. So `clerk-js` stamps the nonce from
      `<ClerkProvider nonce dynamic>` onto the `<style>` elements it injects.
      ⚠️ **"No `style-src` violation" is the precise claim, and it is narrower than "a clean
      console."** The same page load reports **one `script-src` issue — `eval` blocked** — in
      DevTools' **Issues** panel rather than Console, which is why a glance at Console reads as clean.
      It is a different directive and a separate box (below); it does not weaken this one.
      🔴 **The prepared remedy is therefore NOT applied, and must not be.** It would have widened
      `'unsafe-inline'` for the `SIGN_IN_PATH` subtree — and because a nonce makes `'unsafe-inline'`
      inert under CSP3, that meant **deleting the nonce for the whole app on every route**. The
      measurement saved an app-wide CSP weakening that was about to be made on an assumption.
      ⚠️ **What this does NOT cover:** the sign-UP consent step, which the bot-protection box below
      records as rendering unstyled for an unrelated reason. Re-read that box rather than treating
      this one as covering every Clerk surface.
- [ ] **`script-src` — `eval` is blocked in production, and the sign-in card renders anyway.**
      Production is `script-src 'self' 'nonce-…' 'strict-dynamic'`; `'unsafe-eval'` is **dev-only**
      (`proxy.ts`, for React's richer stack traces). On the live instance `/sign-in` reports exactly
      one issue — _"Content Security Policy of your site blocks the use of `eval` in JavaScript"_ —
      while the card renders, Clerk sets `__client`, and a full Google sign-in completes. So it is
      **not fatal to sign-in**; what is unknown is whether some narrower Clerk path depends on it.
      ⚠️ **It surfaces in DevTools' Issues panel, NOT Console**, which is why the first look at this
      page read as clean. Check Issues before recording any CSP box as closed.
      🔴 **Do not reach for `'unsafe-eval'` as the fix.** It is the single most load-bearing thing a
      `script-src` can give away, and `'strict-dynamic'` plus a nonce is the policy the rest of the
      app is built on. The question to answer first is **which** code evals — Clerk's own bundle, or
      a dependency it loads — and whether the affected feature is one this app uses at all. Open.
- [x] ✅ **Clerk's BOT PROTECTION — turned OFF on the PRODUCTION instance, 2026-10-29**, which is
      option 1 below. Measured 2026-10-22, and this is the
      box that actually bit.** `1a` allowed `https://challenges.cloudflare.com` in `frame-src`, read
      off the pinned version's `DEFAULT_DIRECTIVES`. ⚠️ **At `clerk-js` 6.40.0 that is the wrong
      mechanism and the allowance is dead weight:** bot protection now loads
      `cdn.protect.clerk.com/<ins_…>/c/<id>/bootstrap.js`, which then `fetch()`es a probe on
      `*.client.protect.clerk.com` across **five ports — 443, 8443, 18443, 2082 and 992**. Against
      `connect-src 'self' ws: <frontend-api>` **all of them are blocked** (20 violations on one page
      load). Clerk's [CSP guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers)
      documents the symptom: _"the challenge uses ephemeral ports. Without proper CSP configuration,
      the challenge iframe is blocked silently and sign-in/sign-up fails."_
      **The symptom is asymmetric, which is what makes it confusing:** the protection _"applies to
      sign-ups only. It never challenges a sign-in"_, so the **sign-in card renders and works** while
      the **sign-up consent step renders unstyled and its checkbox cannot be ticked**. Do not read
      that as a `style-src` failure; the console shows **zero** style violations.
      **Two ways out, and they are not equivalent:**
  1. ✅ **Preferred — turn the protection OFF**: dashboard **Protect → Protections**
     (`dashboard.clerk.com/~/protect/rules`; the page is titled _Protections_ while the URL still says
     `rules`), row **"Challenge suspicious sign-ups"**, which is **on by default for new
     applications**. Sign-up here is **Invite-only**, a strictly stronger gate than bot detection, so
     this removes a redundant dependency rather than weakening anything — and it needs **no CSP
     change**.
  2. ⚠️ **Widen the CSP** to `connect-src https://*.protect.clerk.com:*` (plus `script-src`, per
     Clerk). 🔴 **This breaks a rule the plan set deliberately** — `proxy.test.ts` pins each added CSP
     source **by exact origin, never a wildcard** — and a wildcard subdomain on _any port_ would be
     the widest source in the policy. Only if (1) proves impossible, scoped to the `SIGN_IN_PATH`
     subtree and pinned in `proxy.test.ts` with the cost written down.
     ✅ **DONE at `AUTH-1` 1d (2026-11-05)**, one chunk later than this box asked: both
     `CLERK_BOT_PROTECTION_ORIGIN` and its `frame-src` entry are **deleted**, with the reasoning kept
     as prose in `lib/clerk.ts` where the const used to be. They were dead code for a mechanism the
     instance has switched off, and the rule this box states — not left to look like working
     protection — is exactly what they failed. **Re-check on every `@clerk/nextjs` bump** — this changed under us
     between the pinned version's own docs and its runtime CDN build.
- [ ] 🔴 **The lit sign-in screen owes its own UX panel, and 1a could not give it one.** With no keys,
      Clerk renders nothing: every screenshot and every a11y assertion on the 1a PR measured the dark
      fallback panel. CI has no Clerk keys, `screenshot:ephemeral` injects none, and the card's DOM
      ships from Clerk's CDN at a **floating major** — so no a11y property of it is pinned by anything
      in this repo. Before 1d retires the gate: run a **full three-lens panel on the lit screen**, with
      Playwright captures at 360 / 390 / 820 / 1280 and a keyboard pass, against the development
      instance.
      ✅ **RUN 2026-11-04, and it found a production-visible defect nothing in CI can see** — Clerk's
      card overhung its column by 48px, and its own spacing had been stripped since `1a` by Tailwind's
      preflight (a `@layer` ordering bug). Fixed in #333; the dated measurements are on
      `tech-debt.md`'s floating-major row. ⚠️ **One failure stands and it is the vendor's:** Clerk's
      attribution link is 48×14px, under the 44px bar and WCAG 2.2 SC 2.5.8, with no `elements` key to
      reach it.
- [ ] 🔴 **Bot/abuse protection enabled**, and **the session lifetime actually configured.** Whether the
      ⚠️ **As of `1d` this box has a consequence it did not have before:** the
      `frame-src` source is deleted, so switching bot protection ON without re-adding it means the
      Turnstile iframe is blocked by `default-src 'self'` — presenting as a sign-in button that does
      nothing, on the app's only door. Re-add the origin and the directive in the same change.
- [x] ✅ **The refusal path, observed 2026-11-05** (`AUTH-1` 1d, lit-panel finding 5). An address that
      had never touched the production instance signed in under `Invite-only`: the refusal rendered
      **on this app's origin**, verbatim _"New sign-ups are currently restricted."_, with the mark and
      both disclosure paragraphs still on screen. No Account Portal, no off-origin dead end. An
      invited-and-accepted address signs in and lands on `NO_HOUSEHOLD_COPY`, as intended.
      ⚠️ **Bound to the mode it was taken under** — production moved to `Waitlist` the same day, which
      replaces that refusal with a link that DOES leave the origin. Re-observe if the mode changes.
- [ ] 🔴 **The invitation record's spec** — where it lives, its fields, its retention. It is what makes
      "the invitation is the record" an actual record rather than a phrase.
- [ ] **Free-tier limits:** MAU, custom domain, Organizations.
- [ ] **The Clerk keys into Vercel** — production and preview **separately**, per OPS-1 — and only once
      the first box above says so.
- [ ] **1b:** read the Clerk user id from the dashboard for the claim correction, and **clear it from
      shell history** afterwards; never paste the dry-run output into a PR.
- [ ] **1b:** the pre-1c check — **all three** of `gh run list` on the merge SHA,
      `information_schema.columns` and `pg_get_constraintdef`.
- [ ] 🔴 **1d — THE ONE OPERATOR ACTION THIS CHUNK LEAVES:** `ACCESS_GATE_PASSWORD` **removed** from
      Vercel (all environments), GitHub Actions and `.env.local` — **after** the code that reads it is
      gone, never before. ✅ **That code is gone as of this PR**, so it is now safe to do and is owed.
      ⚠️ `lib/env.ts` no longer declares the variable, so leaving it set breaks nothing — which is
      exactly why it will be forgotten unless it is done now. GitHub Actions never held it as a
      secret (it was an inline non-secret placeholder in `ci.yml`, removed here).
- [x] **1d:** "Rotate a secret" loses the access-gate code. ✅ **Done 2026-11-05** — the section is
      retitled and takes the `CLERK_SECRET_KEY` rotation as its worked example, which is a procedure
      that has actually been performed (it fixed the sign-in loop) rather than one written from
      imagination.
