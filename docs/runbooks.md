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

```bash
read -s PREVIEW_DIRECT      # paste the preview DIRECT/unpooled string
export EXPECTED_DB_ENV=preview
DATABASE_URL_UNPOOLED="$PREVIEW_DIRECT" pnpm --filter @mat-plan/db db:migrate
DATABASE_URL_UNPOOLED="$PREVIEW_DIRECT" pnpm --filter @mat-plan/db db:seed
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

| Variable                   | Production            | Preview                                | Development         |
| -------------------------- | --------------------- | -------------------------------------- | ------------------- |
| `DATABASE_URL`             | production **pooled** | preview **pooled**                     | preview **pooled**  |
| `ACCESS_GATE_PASSWORD`     | rotated in step 7     | **a NEW long random code** (≥24 chars) | same as Preview     |
| `UPSTASH_REDIS_REST_URL`   | production            | the step-4 database                    | the step-4 database |
| `UPSTASH_REDIS_REST_TOKEN` | production            | the step-4 database                    | the step-4 database |
| `SENTRY_DSN`               | production            | **unset**                              | **unset**           |
| `SKIP_ENV_VALIDATION`      | **never**             | **never**                              | **never**           |
| `ALLOW_LIVE_DB`            | **never**             | **never**                              | **never**           |

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

Eyeball the list: it should hold `DATABASE_URL_UNPOOLED` and `PREVIEW_DATABASE_URL_UNPOOLED` and
nothing else database-related. `migrate-preview.yml` runs only on push to `main` and
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

1. **Record two or three of those `environment_url`s** so you can verify the purge.
2. **Vercel → Deployments → filter Preview → delete every one of them.** (Or loop
   `DELETE /v13/deployments/{id}` with the token from step 8.)
3. **Rotate `ACCESS_GATE_PASSWORD` in the Production scope** to a new long random value, and
   redeploy production.
4. **Rotate the Neon production role password**, then update **both** copies: `DATABASE_URL` in the
   Vercel Production scope and the `DATABASE_URL_UNPOOLED` GitHub Actions secret. Redeploy
   production and re-run "Migrate + seed (production)" to confirm the new string works.

**Rotation is not retroactive, and that generalises.** A credential that was ever injected into a
build stays in that build. So whenever the _preview_ credentials are rotated later, the previews
built before the rotation must be **purged**, not merely superseded.

**Confirm:** `curl -so /dev/null -w '%{http_code}\n' <a recorded URL>` returns `404`, the
`deployments?environment=Preview` count is down to today's, and the production URL accepts the new
gate code and rejects the old one.

### 8. Verify it mechanically

```bash
read -s VERCEL_TOKEN; export VERCEL_TOKEN
export VERCEL_PROJECT_ID=prj_…        # Project → Settings → General
export VERCEL_TEAM_ID=team_…          # only for a team project
pnpm preview:check
unset VERCEL_TOKEN VERCEL_PROJECT_ID VERCEL_TEAM_ID
```

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

1. Neon → delete the `mat-plan-preview` project.
2. Repeat steps 2 and 3, then update `DATABASE_URL` in the Vercel Preview + Development scopes and
   the `PREVIEW_DATABASE_URL_UNPOOLED` secret with the new strings.

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
- `/api` is **not gated at all** — `apps/web/proxy.ts`'s matcher excludes it
  ([tech-debt.md](./tech-debt.md)). Once a Route Handler exists, assume the preview database is
  writable by anyone who finds a preview URL.
- The preview Neon project has **no IP allowlist** on the free tier: the connection string is full
  DDL access, and it now lives in two places (the Vercel Preview scope and an Actions secret).
- **Therefore the preview estate must hold nothing you would mind being public.** That is the whole
  reason a Neon branch of production was never an option.

---

## Manually re-seed / re-apply prod (`workflow_dispatch`)

**When:** you need the prod migrate+seed to run out-of-band (e.g. a catch-up before the change merges,
or after wiring the `DATABASE_URL_UNPOOLED` secret). Since `migrate.yml` now runs on **every** push to
`main`, this is rarely needed — merging is usually enough.

**Steps:** GitHub → **Actions** → **"Migrate + seed (production)"** → **Run workflow** → branch `main`
→ Run. Since OPS-1 the job is guarded with `if: github.ref == 'refs/heads/main'`, so a dispatch from
any other branch is a no-op rather than applying that branch's unmerged migrations to production —
the instruction to pick `main` is now enforced, not just written down. To refresh the **preview**
database from a branch, run `db:migrate` locally against the preview string (OPS-1 step 3), or
dispatch **"Migrate + seed (preview database)"**, which holds no production credential. Check the "Apply migrations + idempotent seed" step didn't print the `DATABASE_URL_UNPOOLED …
skipping` warning.

**Safety:** `db:migrate` is a no-op when nothing is pending; `db:seed` is idempotent.

---

<!-- Placeholder runbooks — fill in when first needed. Keep titles even before the body exists so we
     have a known home for each procedure. -->

## Rotate a secret (Neon password / access-gate code / GitHub Actions secret)

_Still a TODO as a general procedure._ **One case is written up**, because OPS-1 needed it: rotating
the production `ACCESS_GATE_PASSWORD` and the production Neon role password together, propagating to
the Vercel Production scope and the `DATABASE_URL_UNPOOLED` Actions secret — see
[OPS-1 step 7](#7-purge-the-historical-previews-and-rotate-what-they-hold-️) above. Generalise from
there when the next rotation comes up, and carry its one durable lesson with you: **rotation is not
retroactive.** A credential that was ever injected into a Vercel build stays in that build, so the
deployments built before a rotation have to be purged, not merely superseded.

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
