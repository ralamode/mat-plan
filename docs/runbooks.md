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
step `exit 0`s with a warning when `DATABASE_URL_UNPOOLED` is absent — **and** in prod

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'entries_prescribed_snapshot_movement_check';
```

returns the predicate in `packages/db/migrations/0013_prescribed_snapshot.sql`, **and**
`prescribed_snapshot` appears in `information_schema.columns`. Until all three hold, chunk 2's code
names a column that may not exist, on the strength write.

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

---

## Rename / correct a seeded profile in prod

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

## Manually re-seed / re-apply prod (`workflow_dispatch`)

**When:** you need the prod migrate+seed to run out-of-band (e.g. a catch-up before the change merges,
or after wiring the `DATABASE_URL_UNPOOLED` secret). Since `migrate.yml` now runs on **every** push to
`main`, this is rarely needed — merging is usually enough.

**Steps:** GitHub → **Actions** → **"Migrate + seed (production)"** → **Run workflow** → branch `main`
→ Run. Check the "Apply migrations + idempotent seed" step didn't print the `DATABASE_URL_UNPOOLED …
skipping` warning.

**Safety:** `db:migrate` is a no-op when nothing is pending; `db:seed` is idempotent.

---

<!-- Placeholder runbooks — fill in when first needed. Keep titles even before the body exists so we
     have a known home for each procedure. -->

## Rotate a secret (Neon password / access-gate code / GitHub Actions secret)

_TODO — document rotating `DATABASE_URL(_UNPOOLED)` and `ACCESS_GATE_PASSWORD`; update `.env.local` +
Vercel env + the GH secret together; note what re-deploys are needed._

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

## Cut a Neon RESTORE branch before a destructive/backfill migration (rollback prep)

_TODO — document creating a pre-migration Neon restore point/branch (AGENTS.md "Rollback"), and how to
swap to it if a backfill goes wrong._

## Promote `e2e` to a required check (branch protection)

_TODO — the repo-admin branch-protection change to make the `e2e` check required (the PR-28 milestone);
the `ci-skip-e2e` label + auto-skip already keep it green for irrelevant/docs PRs._

## Recover prod after a bad migration / restore from a Neon branch

_TODO — restore-from-branch procedure + how to reconcile the migration journal afterward._

## First-time environment setup (Neon + Vercel + secrets)

_See [deploy.md](./deploy.md) — the one-time Neon/Vercel/secret wiring lives there._

## Verifying V1-14a hardening after wiring the credentials

Neither system can be verified without live credentials, so this is the manual pass to run **once**
after setting the Vercel env. Until then both features no-op by design and the app behaves exactly as
it did pre-V1-14a — that absence path is what CI and local dev exercise.

### 1. Sentry is receiving — and is NOT leaking

1. Set `SENTRY_DSN` in Vercel (all three environments) and redeploy.
2. Trigger a real server error on the **preview** URL (easiest: temporarily point `DATABASE_URL` at a
   bad host, load Today, then revert). The page should render `error.tsx` as before.
3. In Sentry, open the new issue and confirm **all** of:
   - it arrived at all (the DSN is wired);
   - **no `mp_gate` cookie** anywhere in the event — check Request → Headers and Request → Cookies;
   - **no `server_action_form_data.*`** entries under Additional Data;
   - **no request body** (Request → Data) and **no local variables** on any stack frame (Sentry 11
     collects both by default; `SENTRY_DATA_COLLECTION` turns them off);
   - no bodyweight value anywhere in the payload.
     If any of those appear, `lib/sentry-scrub.ts` is not running — treat it as a **security incident**,
     revoke the DSN, and rotate `ACCESS_GATE_PASSWORD`.

### 2. The gate rate limit is enforcing

1. Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel and redeploy.
2. On the preview URL, submit a **wrong** access code 11 times in under 10 minutes.
3. Expect the first ~10 to say "Incorrect access code." and the next to say **"Too many attempts. Try
   again in a few minutes."** — rendered in the form, NOT an error page. An error page means the limit
   is throwing instead of returning its envelope.
4. Wait out the window, confirm a correct code works again.
5. Sanity-check the fail-open path: temporarily set a bogus `UPSTASH_REDIS_REST_TOKEN`. The gate must
   still **work** (fail-open), and later Sentry events should carry a `rate-limit` breadcrumb.

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

Beta 0 has **one shared access code and no per-person identity**, so there is nothing to authenticate
an irreversible request against. Confirm the request through **the channel the invitation went out
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
> precondition of the first real deletion.**

### ⛔ Precondition 2 — a household in the seed cannot be deleted yet

`migrate.yml` runs `db:seed` against production **on every push to `main`**, and the seed upserts the
household and its profiles by fixed `public_id` with `ON CONFLICT DO NOTHING`. That is idempotent only
against a row that **exists** — after a hard delete there is no conflict, **so it inserts**, and the
next merged PR re-creates the household and its named child profiles.

So: **do not delete a seeded household until `OPS-2` splits the seed** (reference data for prod,
fixtures for dev/CI). This applies to the maintainer's own household specifically — the one most
likely to be deleted when the beta ends. A household created through the app is not in the seed and is
unaffected.

### Steps

**0. Record the request.** In the deletion ledger (below), before anything else.

**0b. Record the household's Clerk user ids — before the transaction.** After `AUTH-1` the
Clerk↔household mapping lives in exactly the rows step 4 destroys. If step 6 is interrupted or
forgotten you are left with orphan Clerk accounts — an email address and a Google identity — and
nothing in the database to find them by. Capture them now; the ledger is the recovery path.

**1. The household exports its own data, in the app, while it still has access.**
`/p/<profileId>/export` per athlete.

⚠️ **That export is a partial copy** — no check-ins or life activities, no readiness colours, no "how
it felt" notes, no per-athlete prescribed targets
([data-inventory.md](./privacy/data-inventory.md) §6). The notice promises a full copy on request, so
**ask whether they want one**, and if they do, produce it by hand **before step 4**. Handing over a
partial copy immediately before irreversible destruction is not keeping that promise.

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
UNION ALL SELECT 'prescription_targets', count(*) FROM prescription_targets
  WHERE profile_id IN (SELECT id FROM p) OR prescription_id IN
    (SELECT id FROM prescriptions WHERE block_id IN (SELECT id FROM b));
```

**Pre-flight integrity — every one of these must return 0, or STOP.** `entries.session_id`,
`entries.superset_id` and `prescription_targets.prescription_id` are **unscoped FKs, enforced by the
writers and not by the schema** (`schema.ts` says so above `supersets`). A stray cross-household row
either aborts the transaction half-way or makes this procedure delete a row about another family's
child:

```sql
-- (a) a prescription_target straddling households — BOTH directions:
--       prescription ∈ H but profile ∉ H   → we would delete another family's child's target
--       profile ∈ H but prescription ∉ H   → we would delete another family's prescription target
-- (b) an ENTRY belonging to a profile OUTSIDE H that references one of H's sessions
--       (entries.session_id is independent of entries.profile_id)
-- (c) an ENTRY belonging to a profile OUTSIDE H that references one of H's supersets:
--       FROM entries e
--       JOIN supersets s   ON s.id    = e.superset_id
--       JOIN sessions sess ON sess.id = s.session_id
--       WHERE sess.profile_id IN (SELECT id FROM p) AND e.profile_id NOT IN (SELECT id FROM p)
```

⚠️ **(c) is the direction that actually exists.** `supersets` has no profile column — it is
household-scoped by construction through its session — so "a superset owned by an outside profile" is
not a row that can exist. The reachable defect is the inverse: an **entry** from outside H pointing at
one of H's supersets. Checking the impossible direction instead would leave exactly the
mid-transaction abort that step 3 exists to pre-empt.

Write all three out against the same CTEs, read the numbers, and do not proceed on a non-zero.

**4. Apply — one explicit transaction, and re-check inside it.**

⚠️ **This procedure creates its own write window between steps 3 and 4**: step 1 has the household
using the app, and precondition 1 adds a 7-day pause. With one shared access code and **no per-person
revocation**, the operator cannot close that window without locking every family out. So step 3's
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
-- 4c. The 12 DELETEs, in the order below, against the same CTE shape.
-- 4d. Re-run the COUNT block once more. Every row must read 0.

COMMIT;   -- or ROLLBACK, if 4a was non-zero or any number surprised you
```

**The order is child-before-parent and is not arbitrary.** `entries` carries FKs to **both**
`sessions` and `supersets`, so it must precede both — the non-obvious one, confirmed against
`packages/db/src/schema.ts` by two independent reviews:

| #   | Table                  | Scoped by                                                      |
| --- | ---------------------- | -------------------------------------------------------------- |
| 1   | `entry_set_quantities` | `entry_set_id` ∈ entry_sets of entries of H                    |
| 2   | `entry_sets`           | `entry_id` ∈ entries of H                                      |
| 3   | **`entries`**          | `profile_id` ∈ H — **before 4 and 5**                          |
| 4   | `supersets`            | `session_id` ∈ sessions of H                                   |
| 5   | `sessions`             | `profile_id` ∈ H                                               |
| 6   | `day_readiness`        | `profile_id` ∈ H                                               |
| 7   | `ramp_targets`         | `profile_id` ∈ H                                               |
| 8   | `prescription_targets` | `profile_id` ∈ H **OR** `prescription_id` ∈ prescriptions of H |
| 9   | `prescriptions`        | `block_id` ∈ program_blocks of H                               |
| 10  | `program_blocks`       | `household_id` = H                                             |
| 11  | `profiles`             | `household_id` = H                                             |
| 12  | `households`           | `id` = H                                                       |

Steps 1 and 2 are redundant with the `ON DELETE CASCADE` on `entry_sets.entry_id` and
`entry_set_quantities.entry_set_id` — written out anyway, because **the counts are the proof** and a
cascade reports nothing.

**`deleted_at` appears in no `WHERE`.** This is the documented inversion of corrections README rules 2
and 5: for a deletion, existence _is_ the guard, and soft-deleted rows are exactly what must go.

**5. Verify, after the commit.** Re-run the step-3 counts — all zero — and confirm `movements` is
**not** empty (it is global and must survive). Every FK except the two cascades is `NO ACTION`, so a
table this procedure missed would have aborted the transaction rather than silently orphaning rows;
that is a real safety property, not a hope.

**6. Delete the Clerk users** (after `AUTH-1`). Clerk dashboard → each user id recorded at step 0b →
Delete user. The database delete does not touch Clerk. Before `AUTH-1` there are no per-person
accounts; the shared gate password is **rotated**, not deleted.

**7. Close out.** Record completion in the ledger, delete the held restore branch once the 7-day
window has passed, and tell the household it is done — pointing them at
[notice.md](./privacy/notice.md) → "Deleting your data", which holds the **single** list of what
remains. Do not restate that list here; one list, one place.

### Safety

One explicit transaction, so a partial failure rolls back whole. Targeted by `public_id`. Idempotent
by nature — a second run finds nothing. Every FK but the two cascades is `NO ACTION`, so a table this
procedure missed aborts the transaction rather than silently orphaning rows.

**Blast radius is one household, with one exception named honestly.** Step 8 is the only predicate
that does not chain cleanly to `households.id = H`, and **both** of its arms can reach outside H, in
opposite directions: the prescription-side arm can select a row whose `profile_id` is another
household's child, and the profile-side arm can select a row whose prescription belongs to another
household's program block — i.e. deleting another family's prescription target. That is why step 3(a)
checks both directions and aborts, rather than letting the transaction discover it.

### The deletion ledger

`OPS-3` needs this too, for per-household restores. **One ledger, not two** — a point-in-time restore
inside the window would otherwise quietly resurrect deleted rows, and replaying the ledger is what
makes a deletion stick.

**Where it lives: outside git, and outside the restorable database** — with the operational
credentials. It must not go in `docs/`, in the corrections **Applied** table, or anywhere else in this
repository: _"household X asked to be deleted on date Y"_ is personal data about an identifiable
household, and this repo is public and permanent.

| Field                            | Why                                              |
| -------------------------------- | ------------------------------------------------ |
| Request date                     | The clock for the 7-day window                   |
| Household `public_id`            | The target, never a name                         |
| **The channel that verified it** | Precondition 1's audit trail                     |
| Clerk user ids (step 0b)         | Recovery if step 6 fails after the rows are gone |
| Apply date                       | What `OPS-3` replays against                     |
| Restore-branch-deleted date      | Proof the held copy is gone                      |

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

## AUTH-1 — the consent and dashboard checklist (PRIV-1 supplies it)

[beta-1.md](./milestones/beta-1.md) §3 says Clerk's dashboard settings "live nowhere in code, so they
go in a runbook checklist". This is that checklist's privacy half, written by `PRIV-1` so `AUTH-1` does
not have to invent it. `AUTH-1` owns the rest (the Google OAuth credentials, the domain, the
invite-only setting).

- [ ] **The privacy-policy URL.** Point it at `/privacy` on the app's own domain — which means
      **`PRIV-2` lands first**. ⚠️ **Verify, do not assume:** whether Google's OAuth consent screen
      accepts a URL that is not on a verified domain must be read off Google's console at the time you
      configure it. This checklist assumes it does not, because that is the assumption that is safe if
      wrong.
- [ ] **A consent step at sign-up, before the first write.** Clerk's dashboard has a legal-consent
      setting; **confirm against Clerk's own docs at the pinned version** whether it exists, what it is
      called, and — the part that matters — **whether it blocks sign-up until ticked.** If it does
      neither, `AUTH-1` adds an in-app consent step instead. Do not ship sign-in on the assumption that
      a vendor checkbox is doing this.
- [ ] **What records the consent.** Beta 0 has no account table and no consent column, so the
      **invitation is the record** — sign-up is invitation-only, so who was asked and when is known.
      Storing a consent timestamp is a Beta 1 item. Say which of these is true in the notice.
- [ ] **Update the notice before sign-in goes live**, not after: [notice.md](./privacy/notice.md) →
      "What is changing" currently describes Clerk and Google in the future tense, and the processor
      table in [data-inventory.md](./privacy/data-inventory.md) marks both "not wired".
- [ ] **Confirm the production `DATABASE_URL` carries an `sslmode` parameter.** `client.ts` upgrades
      one to `verify-full` but explicitly will not invent one, and nothing validates it — so TLS
      verification in production is an environment fact, not a code guarantee.
