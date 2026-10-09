- **2026-10-07** — **OPS-1: a Vercel preview can no longer silently reach production — and the repo
  now fails loudly instead of trusting a dashboard** ([plan](../plans/ops-1-preview-isolation.md)).
  Every Vercel scope shared one set of environment variables, so a preview deployment of **any** pull
  request read and wrote the **production** Neon database with the **production** access-gate code,
  Sentry DSN and Upstash token. One rule now lives in `packages/shared/src/db-environment.ts` and is
  enforced in three places: `apps/web/lib/env.ts` refuses to boot when `VERCEL_ENV` and the database
  its `DATABASE_URL` names disagree, and `db:migrate`/`db:seed` refuse a target that disagrees with
  the `EXPECTED_DB_ENV` their workflow declares — **in both directions**, because the quiet mistake is
  the worse one: the preview string in `DATABASE_URL_UNPOOLED` would leave the production migrator
  **green** while production stopped being migrated and drifted. `pnpm preview:check` verifies the
  Vercel project structurally (fork protection, system env vars exposed, nothing sharing the
  production scope, no `SKIP_ENV_VALIDATION`, `DATABASE_URL` per scope) **without ever decrypting a
  value**, and `migrate-preview.yml` is a separate **file**, not a job in `migrate.yml`, so a
  `workflow_dispatch` from a branch cannot reach the production credential — a hazard the same PR
  also closed with a `github.ref` guard on the production job. **The guard is fail-closed by
  accident-proofing, not by trust:** `VERCEL_ENV` sits behind a Vercel project toggle, so a rule keyed
  only on it would silently no-op if that toggle were off; the rule therefore also refuses any
  non-local database when no environment is declared, with `ALLOW_LIVE_DB=1` as the single deliberate
  opt-in (`pnpm dev:prod`). ⚠️ **Most of OPS-1 is dashboard work the repo cannot do, and
  [runbooks.md](../runbooks.md) → OPS-1 is the deliverable** — nine ordered steps, meant to run
  _before_ the merge, because pre-merge code reads none of the new variables. **The backlog row's own
  wording missed the biggest part**, found by the PR's security panel and independently verified:
  Vercel injects env values at **build time**, so re-scoping the project does nothing for previews
  that already shipped — **100 publicly-listed preview URLs were live, each holding the production
  database string and the production gate code**, so the runbook purges them and rotates both.
  **Rotation is not retroactive.** Six documents — `AGENTS.md`, `spec.md`, `architecture.md`,
  `deploy.md`, `service-setup.md` and `plan.md` — claimed previews got a per-PR **Neon branch** of
  production; it was never built, and a branch is a copy-on-write clone that would have put every
  family's bodyweight in every preview, so the claim was both false and the wrong goal. The privacy
  panel added the part nobody else asked: the preview project is a **second copy of personal data**,
  so it is registered in `service-setup.md` and in OPS-3's deletion ledger, declared **disposable**
  with a reset recipe (the seed's `onConflictDoNothing` otherwise re-creates a profile deleted while
  rehearsing deletion), and rollback **deletes** it rather than leaving an orphan no deletion request
  would find.
