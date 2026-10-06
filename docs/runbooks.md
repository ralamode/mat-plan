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
`liam-bodyweight-duplicates-2026-09-30` (V1-24 PR 1c) clears the duplicate weigh-ins that **PR 1d's
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
one-off `UPDATE` is needed. (First occurrence: V1-3 renamed the seed profile "Athlete One" → "Liam",
but prod kept "Athlete One".)

**Why manual:** deliberately not in the seed — an `ON CONFLICT DO UPDATE SET name` would clobber a
name a user later edits. A targeted, guarded correction is safer as a one-off.

**Steps** (Neon dashboard → **mat-plan** project → confirm the **production** database → **SQL Editor**):

```sql
UPDATE profiles
SET name = 'Liam', updated_at = now()
WHERE public_id = '019826b4-0000-7000-8000-000000000001'  -- the target row's public_id
  AND name = 'Athlete One'                                 -- guard → no-op if already renamed
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
