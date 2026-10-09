# OPS-1 — previews hold neither production data nor production credentials

> Backlog: [plan.md](../plan.md) row OPS-1. Branch: `chore/ops-1-preview-isolation`.
> Milestone: [beta-1](../milestones/beta-1.md) §1 (ops fit for other people's data).
>
> **Reshaped by six panel lenses** — correctness, scope, architecture, reuse, security, privacy. The
> log is at the bottom. Three of them changed the shape of the work rather than its detail: the scope
> lens deleted a whole guard layer that caught nothing, the security lens found the hole this row's
> own wording misses, and the privacy lens found that the fix creates a data copy with no delete path.

## Goal

Today a Vercel preview deployment of **any** pull request runs against the **production** Neon
database with the **production** access-gate code, Sentry DSN and Upstash credentials — one set of
environment variables serves Production, Preview and Development alike
([service-setup.md](../service-setup.md) §3). A preview URL can read every logged bodyweight and can
write to the real database. That is tolerable with one family whose data it is; it is the thing that
must not be true before a second family is invited.

Almost all of the fix is dashboard configuration this repo cannot perform. So this PR ships the
**mechanical things the repo can own** — a boot-time guard that makes a misconfigured deployment fail
its build instead of quietly reaching production, the same rule applied to the migrator, and a
verification script that reads the Vercel project configuration back — plus **the runbook the
maintainer executes**, which is the main artifact.

**This PR does not finish OPS-1.** The repo half merges here; the row is done when the runbook has
been executed and its closeout commit has landed. `docs/plan.md` and `docs/status.md` carry that
outstanding state, so it does not live only in a plan that convention never retro-edits.

## Acceptance

**Verbatim, from [plan.md](../plan.md) row OPS-1:**

> **OPS-1 — previews hold neither production data nor production credentials.** Today every Vercel
> preview gets the prod `DATABASE_URL` ([deploy.md](./deploy.md)). Previews get a seed-only database
> (never a branch of prod, which would clone every family's data), the Preview scope holds no
> production secret (separate Clerk dev instance, Upstash, Sentry DSN), and Vercel's fork-PR
> protection is verified on. _(Beta 0.)_

**Done when — repo half (this PR):**

1. `assertDatabaseEnvironment` in `packages/shared` refuses, **fail-closed**, any deployment whose
   `VERCEL_ENV` disagrees with the database its `DATABASE_URL` names — and any off-platform process
   pointed at a non-local database without the deliberate `ALLOW_LIVE_DB=1` opt-in.
2. The same rule guards the **migrator**: `db:migrate` and `db:seed` refuse a target that disagrees
   with the `EXPECTED_DB_ENV` its workflow declares, in both directions.
3. `pnpm preview:check` reads the Vercel project over the REST API and asserts: fork protection on,
   system environment variables exposed, **no variable record shares the `production` target with any
   other scope**, no `SKIP_ENV_VALIDATION` anywhere, and `DATABASE_URL` present separately per scope.
   It never decrypts, never fetches a variable by id, prints no value, and refuses a snapshot path
   inside the working tree.
4. `.github/workflows/migrate-preview.yml` migrates and seeds the preview database, in its own file
   so the production credential is not reachable from a branch dispatch.
5. [runbooks.md](../runbooks.md) carries the ordered procedure with a confirmation per step, the
   credential **rotation**, the historical-preview **purge**, the preview project's **reset** recipe,
   token hygiene, residual risks and the closeout commit; [deploy.md](../deploy.md) carries the
   per-scope wiring (its existing pointer already says wiring lives there).
6. Six documents stop claiming previews get a per-PR Neon branch of production, which they never did
   — including `AGENTS.md` itself.
7. The preview Neon project is registered as a **named location that holds personal data**, in
   [service-setup.md](../service-setup.md) and in OPS-3's deletion-ledger row, so a future deletion
   request has two places to walk and not one.

**Done when — the maintainer's half (not this PR):** the runbook has been executed end to end,
including the purge and the rotations, and the closeout commit has landed. Until then OPS-1 is open.

## What is actually configured today (verified, 2026-10-07)

The brief asked for the real state, not the documented one.

| Claim                                                                  | Reality                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview deploys come from the Vercel GitHub app                        | **True.** `gh api repos/ralamode/mat-plan/deployments` shows `vercel[bot]` creating `Preview` deployments per push, `Production` on `main`.                                                                                                                                                                                                                 |
| The repo is public                                                     | **True.** `visibility: public`, not a fork.                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_URL` is one value across Production, Preview and Development | **Documented as such** ([deploy.md](../deploy.md) §2, [service-setup.md](../service-setup.md) §3) **and nothing in the repo can override it.** No `vercel.json` on `main`, no Neon–Vercel integration artifact, no code or workflow that gives a preview a different string.                                                                                |
| So is every other credential                                           | Same — `ACCESS_GATE_PASSWORD`, `SENTRY_DSN`, `UPSTASH_*`: one value per variable across all three scopes.                                                                                                                                                                                                                                                   |
| "Preview deploys point at a per-PR **Neon branch** (prod-shaped)"      | **False, in six places:** [deploy.md](../deploy.md):162 (as "later, V0-11" — V0-11 shipped long ago), [architecture.md](../architecture.md):273 (present tense, in the topology diagram), [spec.md](../spec.md):36, [plan.md](../plan.md):2020, and **`AGENTS.md`:307**, the file every session reads first. No Neon branching exists anywhere in the repo. |
| Vercel fork-PR protection is on                                        | **Unknown and unverifiable from here** — no Vercel CLI or token on this machine, by design. This is what `preview:check` exists for.                                                                                                                                                                                                                        |
| Vercel's system environment variables are exposed                      | **Unknown.** A project toggle (`autoExposeSystemEnvs`); `VERCEL_ENV` does not exist without it. Also what `preview:check` exists for.                                                                                                                                                                                                                       |
| GitHub Actions holds only `DATABASE_URL_UNPOOLED`                      | **Unverifiable** — the available token cannot list repository secrets (403). The runbook has an eyeball step.                                                                                                                                                                                                                                               |

**The finding is worse than the row states, in two ways.**

**One: it is not only `DATABASE_URL`.** _Every_ credential is shared, so the Preview scope holds the
production access-gate code — the one secret standing between a preview URL and the data — plus the
production Sentry DSN and Upstash token.

**Two, and the row's wording misses this entirely: the previews that already exist keep what they
were built with, forever.** Vercel injects environment values at build time, so re-scoping the
project changes nothing for a deployment that has already shipped. Verified:

```
$ gh api "repos/ralamode/mat-plan/deployments?environment=Preview&per_page=100" --jq 'length'
100
$ # each has an environment_url in /statuses — anonymously readable, because the repo is public
$ curl -so /dev/null -w '%{http_code}\n' https://mat-plan-qgmgvqsal-mat-plan.vercel.app
200
```

**At least 100 publicly-listed preview URLs are live right now, each holding the production database
string and the production gate code in its runtime environment.** Cutting the connection fixes only
_future_ deployments. Without the purge-and-rotate steps this runbook adds, the acceptance sentence
would read green on the day of merge while both credentials guarding the bodyweight series were still
the ones previews were built with — which is the exact class of claim the audit above is correcting.
_(Found by the security lens, reinforced by the privacy lens, independently re-verified here.)_

Finally: the "per-PR Neon branch" mechanism those six documents claim was **never built**, so there is
nothing half-built to unpick — and had it been built, it would have been the very thing OPS-1 rejects.
Documentation that claims a safety mechanism which does not exist is the failure mode this repo
already has a [tech-debt](../tech-debt.md) entry about; correcting it is part of the deliverable.

## Design

### Rejected shapes, with reasons

- **A Neon branch of production.** The row rejects it and the reason holds: a branch is a
  copy-on-write clone, so every family's bodyweight is in every preview. Neon's own Vercel
  integration offers exactly this, which is why the rejection is now written in three places.
- **Turning previews off.** The Definition of Done has a "preview deploy manually verified" box, and a
  preview is how a UI change is reviewed on a phone. That trades a real workflow for a shortcut.
- **A per-PR database.** Provisioning one needs a Neon API token in CI; a fork PR gets no secrets on a
  public repo, so the token would have to be reachable from a `pull_request_target`-shaped workflow, a
  class this repo deliberately does not have. One shared preview database costs nothing on the free
  tier and needs no new credential in CI.
- **Committing a hash of the production `DATABASE_URL`** so the app could compare against it. That is
  a derivative of a live credential in a public repo. No.
- **A marker row the preview seed writes.** Needs a migration and a seed change (the seed split is
  **OPS-2**), costs a round-trip on cold start, and fails open if the query errors.

### What previews get

**One long-lived Neon project, `mat-plan-preview`, one database named `mat_plan_preview`, shared by
all preview deployments, built only from `db:migrate` + `db:seed`.** Not a branch of anything.

**It is declared disposable, and that is load-bearing.** A preview is where write paths get exercised,
so this database accumulates whatever any reviewer types — it does **not** hold "seed data only" after
the first preview, and the plan should not claim it does. Worse, `seed.ts`'s
`onConflictDoNothing({ target: profiles.publicId })` **re-creates** a fixture profile that was
soft-deleted while rehearsing a deletion flow, on the next push to `main`: the one datastore where
someone would test deletion actively undoes it. So the runbook gives it a **reset** recipe (drop the
Neon project, re-create, re-migrate, re-seed — minutes), with stated triggers: before a demo, after a
deletion rehearsal, and whenever a reviewer has entered values. _(Privacy lens.)_

**The schema-lag question, answered honestly:** a shared preview database is migrated on merge to
`main`, so a PR that adds a migration gets a preview on the _pre-migration_ schema. That is **exactly
today's behaviour** — production is also migrated on merge, not on PR — so it is not a regression, and
the e2e smoke (ephemeral Postgres, migrated from the branch) is the pre-merge proof. The escape hatch
is a **local** run of `packages/db/scripts/migrate.ts` against the preview string, **not** a
`workflow_dispatch` from the branch: dispatching `migrate.yml` off `main` would run the _production_
job with the branch's unmerged migrations. The runbook says so, and this PR adds a
`github.ref == 'refs/heads/main'` guard to that job so the instruction cannot be followed by accident.

### The guard: one rule, three places it is enforced

The first draft had a `DATA_ENVIRONMENT` variable declared per Vercel scope and cross-checked against
`VERCEL_ENV`. The scope lens showed it caught nothing a `VERCEL_ENV`-keyed rule does not, while being
the sole cause of the plan's worst risk (merging would have broken the production build until a
dashboard step was done). It is gone. What remains is **one rule**, in `packages/shared`, enforced in
three places.

```
assertDatabaseEnvironment({ vercelEnv, databaseUrl, allowLiveDb })

  databaseUrl absent                      → pass   (nothing to connect to)
  database name unparseable or empty      → THROW  (fail closed)
  vercelEnv === 'production'              → name must NOT contain 'preview'
  vercelEnv set, anything else            → name MUST contain 'preview'
  vercelEnv absent, host is local         → pass   (dev, CI, e2e, PGlite, screenshots)
  vercelEnv absent, host is NOT local     → THROW  unless allowLiveDb
```

**The last rule is what makes this fail closed, and it is the panel's doing.** `VERCEL_ENV` is a
Vercel _system_ environment variable, gated on the project's "Enable access to System Environment
Variables" toggle ([Vercel docs](https://vercel.com/docs/environment-variables/system-environment-variables),
read 2026-10-07: available at both build and runtime, values `production | preview | development`, and
the whole family is behind that checkbox). A `VERCEL_ENV`-keyed rule alone would therefore **silently
no-op** if the toggle were off — leaving today's exact hole in place. Keying the "no environment
declared" case off database _locality_ closes it without depending on the toggle at all: off Vercel
every caller in this repo is already `localhost`/`127.0.0.1` (verified across the embedded-Postgres
harness, `ci.yml`'s build placeholder and e2e service, and `vitest.config.ts`), so the only process
needing the `ALLOW_LIVE_DB=1` opt-in is `pnpm dev:prod`, which exists to target live Neon on purpose
and already prints a warning. `preview:check` still asserts `autoExposeSystemEnvs`, because a
maintainer should learn the toggle is off from a verification run, not from every build failing.

**Note the third rule covers `development` too.** Vercel's Development scope holds the same production
values today, and `vercel env pull` would hand them to a laptop. Anything that is not `production`
must name a preview database, so that scope is inside the rule rather than silently outside it.

**Why a naming convention, and what it cannot do.** The rule compares `VERCEL_ENV` against the
**database name** in `DATABASE_URL` — the only thing available from inside a deployment that inspects
the _actual connection string_ rather than another declaration. It catches the highest-consequence
mistake, the production string in the Preview scope, because production's database is not named
`…preview`. It **cannot** catch a preview database someone named like production, or a production
database renamed to contain `preview`. The runbook therefore makes `mat_plan_preview` a load-bearing
instruction and says why. The name is a const, not a literal retyped in four places.

**No message says anything about `DATABASE_URL`.** Every throw is one of a small set of exported
constant strings, interpolating only `vercelEnv` (a non-secret platform value). Not the host, not the
user, not even the database name — because this function throws at module import, so its message
becomes a Vercel build-log line and, in a live deployment, a Sentry event. The messages carry the
**rule** instead of the observed value, which is just as actionable:
_"VERCEL_ENV=preview, but DATABASE_URL does not name a preview database (its database name must
contain 'preview' — see docs/runbooks.md → OPS-1)."_ The test asserts **equality** against the
exported constant; `expect(msg).not.toContain(password)` would pass vacuously for any message.

**Place 1 — the app.** `apps/web/lib/env.ts` calls it **unconditionally**, reading its inputs from
`process.env` (the one module allowed to), **outside** the `SKIP_ENV_VALIDATION` gate. Nothing in the
repo sets that flag today, and leaving the guard behind it would make `SKIP_ENV_VALIDATION=1` in a
Vercel scope a one-click, silent kill switch for the whole deliverable — exactly the reaction a red
build invites. `preview:check` additionally fails if that variable exists in any scope.

**Place 2 — the migrator.** `packages/db/scripts/migrate.ts` and `seed.ts` take whatever
`DATABASE_URL_UNPOOLED` they are handed, with no check. This PR introduces a _second_ migrator secret,
so the mistake is now live in both directions, and the quieter direction is worse: the production
string in `PREVIEW_DATABASE_URL_UNPOOLED` DDLs and seeds **production** (the seed is
`ON CONFLICT DO NOTHING`, so it is silent), while the preview string in `DATABASE_URL_UNPOOLED` makes
the production job go **green** as production stops being migrated and drifts — the same failure class
`migrate.yml`'s own header comment was written about. Both scripts now assert against
`EXPECTED_DB_ENV`, which each workflow sets; unset means no check, so local runs, CI and `db:verify`
are untouched.

**Place 3 — the Vercel configuration.** The two in-deployment places can only see their own
environment. The structural fact OPS-1 needs — _no variable is shared out of the Production scope_ —
is visible only from the Vercel API.

### `preview:check` — what it asserts and what it refuses to do

It needs **no secret values**. `GET /v10/projects/{id}/env` returns each record's `key`, `type` and
`target` scopes without decryption, so "is `DATABASE_URL` one record targeting several scopes, or one
record per scope?" — the exact shape of today's misconfiguration — is answerable structurally. The
script **never passes `decrypt`, never calls the per-id `…/env/{id}` endpoint, and prints no value**;
the self-test asserts the set of URLs it builds contains no `/env/` path. (`decrypt` is marked
deprecated in Vercel's spec, so the claim rests on the endpoint set, not on omitting one parameter.)

Checks: fork protection on · system env vars exposed · **no record shares the `production` target with
any other scope** · no `SKIP_ENV_VALIDATION` record anywhere · `DATABASE_URL` present separately in
each scope. Exit codes follow the convention the other two guards fought for
(`check-audit.mjs`, `check-action-pins.mjs`): **0** ok, **1** isolation is broken, **2** could not
check — unreachable, unauthenticated or an unexpected API shape, in which case **nothing was
asserted**. Collapsing 1 and 2 is how a network outage comes to look like a verified pass. Every check
fails on _field absent_ rather than passing: `gitForkProtection` appears in no `required` list in
Vercel's schema, so it can legitimately be missing on a project whose toggle was never written — the
runbook's step is therefore "toggle off, save, on, save", so the field is persisted and the check can
go green.

**The sharing check uses an explicit, empty `SHAREABLE` allowlist, not a list of secrets to watch.**
The architecture lens showed a blanket "nothing is shared" rule will false-fail on AUTH-1's first
correct Clerk wiring, which legitimately shares non-secret path constants
(`NEXT_PUBLIC_CLERK_SIGN_IN_URL` and friends) while only `pk_`/`sk_` differ — and that the predictable
response is to weaken the check. The reuse lens showed, from the opposite direction, that a
hand-maintained list of _secrets to check_ drifts **invisibly**: a credential added to `lib/env.ts`
and not to the list is simply never asserted, and the script prints all-green. Only one shape
satisfies both: fail on **every** shared variable, and require a deliberate, commented allowlist entry
to excuse one. It starts empty, so there is nothing to drift; the cost is that a legitimate sharing
reds the check until someone writes down why — which is the prompt you want.

**Why it is not a CI job.** It needs a Vercel API token, and Vercel tokens are account- or team-scoped
with **no read-only scope**: one can decrypt every production environment variable in the project and
create deployments. Putting a credential with that reach into a public repo's Actions secrets, to
verify that credentials are not over-shared, inverts the trade. It is a local command the runbook
invokes, with hygiene in the runbook: team-scoped, shortest available expiry, supplied via
`read -s VERCEL_TOKEN` (not a committed file, not shell history), **revoked as the runbook's last
step**. Committed snapshots are **crafted only** — a live capture carries the project id, `createdBy`,
the full variable-key inventory and plain values, and gitleaks flags none of it — so a capture goes to
the gitignored `.local-secrets/`, and the script **refuses a `--snapshot` path that resolves inside
the working tree**. The runbook also says not to paste `preview:check` output into a public PR: the
pass/fail is shareable, the key inventory is not.

### Residual risk after this PR — stated, not implied

A preview is not an obscure URL. `gh api repos/ralamode/mat-plan/deployments` plus `/statuses` returns
`environment_url` for every preview ever made, anonymously, because the repo is public (verified
above). So:

- **A preview is a publicly-listed, internet-reachable deployment whose only control is a shared
  code**, unless Vercel's **Deployment Protection** is on. The runbook adds a step to _record what
  this account's plan offers and what is currently set_, rather than this plan asserting which tier
  is free: Vercel ships two different things there — **Vercel Authentication** (SSO-gated previews)
  and **Password Protection** — and conflating them is how a control gets dismissed unexamined. The
  trade-off is real either way: with SSO on, a reviewer without Vercel access cannot open a preview,
  which touches the DoD's "preview deploy manually verified" box. _(Privacy lens.)_
- **The gate has no rate limit unless Upstash is wired.** `apps/web/lib/rate-limit.ts` sets
  `limiter = null` when the credentials are absent and `checkRateLimit` fails open by design. A
  publicly-listed URL with an unlimited password oracle is not an acceptable default, so the runbook
  gives Preview **its own free Upstash database** — which the backlog row asks for anyway — and
  requires the preview gate code to be long and random.
- **`/api` is not gated at all** (`apps/web/proxy.ts`'s matcher excludes it; accepted debt in
  [tech-debt.md](../tech-debt.md)), so once a Route Handler exists the preview database must be
  assumed writable by anyone who finds a preview URL.
- **Fork-PR protection is the control that matters most, and the threat is not "a fork reads data".**
  It is that a fork PR's **build executes attacker-controlled code with the Preview scope's
  environment** — a hostile `postinstall`, `next.config.ts` or build script exfiltrates
  `PREVIEW_DATABASE_URL`, the preview gate code and everything else in one request. Its only detector
  here is a local, non-gated script, and the setting is one dashboard click from off. Standing runbook
  line: if a fork preview ever builds, rotate the preview database password and the preview gate code,
  and purge that deployment.
- **The Neon preview project has no IP allowlist on the free tier**, so its connection string is full
  DDL access, and it now lives in two new places (the Vercel Preview scope and an Actions secret).

**Therefore: the preview estate must hold nothing we would mind being public.** That is the design
constraint, and it is why a Neon branch of production was never an option.

### The personal data this creates, and who owns deleting it

The preview project will hold the seed's fixture profiles, which carry **two minors' first names**.
Three honest statements the first draft got wrong:

1. **The names are OSS-1 follow-up #2's problem, not OPS-2's.** [plan.md](../plan.md):467 records the
   rename as decided by the maintainer on 2026-10-01 and not yet shipped — "the kids' names are
   already published in `seed.ts`, `global.setup.ts` and `steps.ts`". OPS-2 is the
   `seedReference`/`seedFixtures` _split_, a different row. The attribution is corrected here, and
   `runbooks.md` is **added to that row's sweep list**, because its "Rename / correct a seeded
   profile" entry embeds the same name in committed SQL and the row names only three files.
2. **Because the preview project is disposable, the rename does not become more expensive.** A rename
   is fresh-DB-only (`onConflictDoNothing` keeps the existing row's name), which would normally mean
   running the manual correction against a second database forever. The reset recipe answers it: after
   the rename lands, the preview project is dropped and re-seeded, and it picks the new names up for
   free. This is the main reason "disposable" is a design property and not a convenience.
3. **It is a second copy, and it is now written down as one.** `service-setup.md` gains the preview
   project as a named location that holds personal data, and OPS-3's deletion-ledger row is told it
   has two places to walk. Rollback **deletes** that Neon project rather than leaving it "harmlessly"
   in place with nothing in the repo referencing it — which is the textbook copy a deletion request
   misses.

Is this still the right trade? Yes, and it is a sequencing choice with a named cost rather than
"not required": a _migrate-only_ preview database has no reference rows and no profiles, so every
preview lands on the broken first-run screen (`ONB-0` is an open P0) and the DoD's "preview deploy
manually verified" box loses its subject. **Reference-only is the right middle, and reference-only is
exactly what OPS-2's split creates** — so OPS-1 going first materializes rows that OPS-2 exists to
stop reaching a database. That ordering is the maintainer's call; the cost is recorded, not absorbed,
and if OSS-1 follow-up #2 lands first the names never enter the preview project at all.

### What fails, and how loudly

| Mistake                                                        | Caught by                                               | Symptom                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Production `DATABASE_URL` in the Preview scope (today's state) | the app guard                                           | Vercel **preview build fails**, no value echoed                 |
| A variable set for "All Environments"                          | the app guard (for `DATABASE_URL`) + `preview:check`    | preview build fails / check fails                               |
| Preview `DATABASE_URL` in the Production scope                 | the app guard                                           | production build fails                                          |
| A record shares `production` with `development`                | `preview:check`                                         | check fails (the two-of-three gap the privacy lens found)       |
| Vercel system env vars switched off                            | the app guard (locality rule) + `preview:check`         | every build fails, with a message naming the toggle             |
| `SKIP_ENV_VALIDATION` set in any scope                         | `preview:check`                                         | check fails                                                     |
| Production string in `PREVIEW_DATABASE_URL_UNPOOLED`           | the migrator guard                                      | the preview migrate job fails before any DDL                    |
| Preview string in `DATABASE_URL_UNPOOLED`                      | the migrator guard                                      | the production migrate job fails instead of going green         |
| A shared `ACCESS_GATE_PASSWORD` / DSN / Upstash token          | `preview:check`                                         | check fails                                                     |
| Fork-PR protection off                                         | `preview:check`                                         | check fails                                                     |
| **Historical previews holding production credentials**         | **nothing in code** — runbook purge + rotation          | silent; this is why those steps exist                           |
| A preview database named like production                       | **nothing** — the runbook's naming instruction          | silent                                                          |
| Two _distinct_ Vercel records holding the _same_ value         | **nothing** — would need decryption                     | silent; stated in the script header                             |
| A reviewer's writes accumulating in the preview database       | **nothing** — the reset recipe                          | by design; it is disposable, not pristine                       |
| `.env.local` pointing at production for local dev              | pre-existing `assertLocalDbUrl` + the `dev:prod` opt-in | out of scope, named so the omission is not read as an oversight |

## File-by-file changes

| Path                                                         | Change | What & why                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/db-environment.ts`                      | NEW    | The one rule: `DEPLOY_ENVIRONMENTS`, `PREVIEW_DB_NAME`/`PREVIEW_DB_NAME_TOKEN`, `databaseNameOf`, `isLocalDbHost`, `DB_ENV_ERROR` message constants, `assertDatabaseEnvironment`, `assertMigrationTarget`. Zero-dep and pure, so **both** `apps/web` and `packages/db` reach it.                                     |
| `packages/shared/src/db-environment.test.ts`                 | NEW    | Colocated; every pass/throw case by **equality** against the error constant, plus a pin on the constant set.                                                                                                                                                                                                         |
| `packages/shared/src/index.ts`                               | EDIT   | Re-export.                                                                                                                                                                                                                                                                                                           |
| `apps/web/lib/env.ts`                                        | EDIT   | Declare `VERCEL_ENV` as `z.string().optional()` — the vocabulary is Vercel's, and a custom environment reports a slug outside the three, which should surface as the guard's named error rather than a generic zod failure. Call the assert **unconditionally**.                                                     |
| `apps/web/package.json`                                      | EDIT   | `dev:prod` gains `ALLOW_LIVE_DB=1` — the single deliberate opt-in.                                                                                                                                                                                                                                                   |
| `apps/web/scripts/screenshot-ephemeral.ts`                   | EDIT   | A comment only. Checked during implementation: `--use-live-db` starts **no** server — it captures against one the caller already started — so the guard is enforced by that process's own env, which `pnpm dev:prod` now sets. The embedded path builds a `127.0.0.1` string and passes the locality rule unchanged. |
| `apps/web/.env.example`                                      | EDIT   | Document `ALLOW_LIVE_DB`, and that `DATABASE_URL` is per-Vercel-scope now.                                                                                                                                                                                                                                           |
| `packages/db/scripts/migrate.ts`, `seed.ts`                  | EDIT   | `assertMigrationTarget(process.env.EXPECTED_DB_ENV, url)` before connecting; unset ⇒ no check.                                                                                                                                                                                                                       |
| `.github/scripts/check-preview-isolation.mjs`                | NEW    | The five checks. Plain Node + `fetch`, no dependency. `--snapshot <file>\|-` injects a **crafted** response for the self-test (house style: `check-audit.mjs --report`), refused if it resolves inside the tree.                                                                                                     |
| `.github/scripts/check-preview-isolation.test.sh`            | NEW    | Offline self-test over crafted snapshots — including today's actual misconfiguration as a must-fail case, the exit-2 cases, and the "no `/env/` URL, no value echoed" assertions.                                                                                                                                    |
| `package.json`                                               | EDIT   | `preview:check` (the `<thing>:check` family); add the self-test to `guards:test`. **Not** in `pnpm verify` — it needs a network token.                                                                                                                                                                               |
| `.github/workflows/migrate-preview.yml`                      | NEW    | Its own file, not a job in `migrate.yml`, so a branch dispatch cannot reach the production credential. Sets `EXPECTED_DB_ENV: preview`.                                                                                                                                                                              |
| `.github/workflows/migrate.yml`                              | EDIT   | `EXPECTED_DB_ENV: production`; `if: github.ref == 'refs/heads/main'` on the job, so the production migrator is unreachable from a branch dispatch.                                                                                                                                                                   |
| `docs/runbooks.md`                                           | EDIT   | **The main artifact** — the ordered procedure, confirmations, rotation, purge, reset recipe, token hygiene, residual risks, closeout commit. Plus a fix to the V1-14a step the guard breaks (below), and the rotation TODO this fills in for one case.                                                               |
| `docs/deploy.md`                                             | EDIT   | Per-scope variable table; a **Preview** row in the table the file itself calls "the canonical reference" for how a schema change reaches each environment (it has Dev/Prod/CI and would otherwise gain a fourth migrated environment with no row); delete the false Neon-branch line.                                |
| `docs/service-setup.md`                                      | EDIT   | §3's ✅/✅/✅ matrix becomes per-scope; the GitHub-secrets table's "**Nothing else.**" is now false; the preview Neon project added as a named location holding personal data.                                                                                                                                       |
| `docs/architecture.md`                                       | EDIT   | §5 topology: preview points at the seed-only preview project.                                                                                                                                                                                                                                                        |
| `docs/spec.md`, `AGENTS.md`                                  | EDIT   | The remaining false Neon-branch claims.                                                                                                                                                                                                                                                                              |
| `docs/plan.md`                                               | EDIT   | OPS-1's link + outstanding dashboard half; OPS-3's deletion ledger told about the second location; OSS-1 follow-up #2's sweep list gains `runbooks.md`; the "Resolved decisions" line **annotated as superseded**, not rewritten — that section is provenance.                                                       |
| `docs/tech-debt.md`                                          | EDIT   | The preview migrate job's green skip, with "payoff trigger: the maintainer executes the OPS-1 runbook".                                                                                                                                                                                                              |
| `docs/status.md`, `docs/roadmap.md`                          | EDIT   | OPS-1's outstanding dashboard half, so the pending state lives where status lives.                                                                                                                                                                                                                                   |
| `docs/changelog/2026-10-07-chore-ops-1-preview-isolation.md` | NEW    | Fragment.                                                                                                                                                                                                                                                                                                            |

**Size, stated because every comparable plan in this repo states it:** ~900 lines, most of it the
runbook, the self-test and the document corrections. That is over the <400 target, and it is one
concern — preview isolation — delivered as the guard, the verification and the procedure, which the
row asks for together. If a reviewer insists on a split, the clean cut is
`check-preview-isolation.mjs` + its self-test (~330 lines) into a follow-up written against a real API
response after the runbook's first run; the guard and the runbook are what make the row true.

### Notes a reviewer would otherwise re-litigate

- **`packages/shared` is the right home** because `packages/db`'s migrator is a genuine second
  consumer across a package boundary — the constants rule's own trigger. The first draft argued "only
  one package reads it"; the reuse and architecture lenses both showed that was false.
- **The repo already has three copies of "parse a `DATABASE_URL`, fail closed, never echo it"** —
  `isLocalDbUrl`/`hostOf` in `apps/web/scripts/embedded-pg.ts`, `assertDbTargetAllowed` in
  `screenshot-ephemeral.ts`, and a third `try { new URL(url).host }` in
  `packages/db/scripts/correct.ts`. This PR adds no fourth: the shared module becomes the home.
  Pointing those three at it is a separate, mechanical PR, deliberately **not** done here.
- **Duplicating `migrate-preview.yml`'s four setup steps is correct, not laziness.** `ci.yml` already
  has two copies of the `Setup pnpm` block, there is no `.github/actions/`, and a local composite
  action would **fail** `pnpm actions:check` (`check-action-pins.mjs`: a local `./` action's own
  `uses:` lines are not scanned). The only allowed de-dup shapes are a `strategy.matrix` or a
  `workflow_call`, both new patterns needing their own justification.
- **`env.VERCEL_ENV` is the variable [ADR 0001](../decisions/0001-observability-and-web-vitals.md) §1
  already asks for** ("gate it through `lib/env.ts` … add a validated, optional var") for Speed
  Insights. That PR reuses it rather than adding a second "am I production?" variable.
- **`.github/scripts/` is the right home** for a non-CI check: `check-skills.mjs` and
  `check-audit.mjs` already live there and run only in local `pnpm verify`. A new root `scripts/` or
  `ops/` directory would fight AGENTS.md's root rule and need its own reorganization proposal.
- **The guard breaks an existing runbook step, which is why that section is in the edit list.**
  [runbooks.md](../runbooks.md) → "Verifying V1-14a hardening" step 2 says to trigger a Sentry event
  by "temporarily point `DATABASE_URL` at a bad host". After this PR a bad host whose database name
  lacks `preview` fails the _build_, so there is no page to load. The replacement trigger is a
  valid-shaped but unreachable host that keeps the name — `postgres://u:p@127.0.0.1:1/mat_plan_preview`
  — which passes boot and fails at connect, exactly the shape that step wants.
- **`apps/web/vercel.json` does exist** — on the `screenshots` orphan branch, written by
  `publish-screenshots.ts` (#183). The "no `vercel.json`" finding above is about `main`, and that is
  where a future Vercel config would have to go.

## The runbook (summary; the procedure itself lands in `docs/runbooks.md`)

**Ordered so every dashboard step precedes the merge**, because pre-merge code reads none of the new
variables — so there is no window in which anything is broken. Run it, then merge.

0. Preflight: confirm the **production** database's name does **not** contain `preview` (the one way
   merging could break the production build); confirm Vercel's **Enable access to System Environment
   Variables** — the guard reads `VERCEL_ENV`; record what **Deployment Protection** this account
   offers and what is set.
1. Confirm **fork-PR protection**: toggle off → save → on → save, so the field is persisted.
2. Neon: **new project** `mat-plan-preview`, database `mat_plan_preview` (the name is load-bearing).
   Copy the pooled and direct strings.
3. Migrate + seed it **from a laptop**, `DATABASE_URL_UNPOOLED` pointed at the preview direct string.
4. Upstash: a **second** free Redis database, for Preview.
5. Vercel: split the scopes. Preview gets the preview pooled string, a **new** long random
   `ACCESS_GATE_PASSWORD`, the preview Upstash pair, **no** `SENTRY_DSN`. Development gets the preview
   string too. Production keeps its own. No variable targets more than one scope.
6. GitHub: add `PREVIEW_DATABASE_URL_UNPOOLED` (the preview **direct** string). Eyeball that the
   secrets list holds only the two. _(Optional hardening: move both into a GitHub Environment with a
   `main`-only deployment-branch policy, so a future workflow cannot reference them by accident.)_
7. **Purge and rotate — the step the row's wording misses.** Record a couple of preview URLs, then
   delete every historical preview deployment (Vercel → Deployments → Preview → delete). Rotate the
   **production** `ACCESS_GATE_PASSWORD` and the **Neon production role password**, propagating the
   latter to Vercel Production's `DATABASE_URL` and the GitHub `DATABASE_URL_UNPOOLED` secret, then
   redeploy production. Both were baked into every preview ever built, and rotation is not
   retroactive. Confirm with `gh api …/deployments?environment=Preview --jq length` and a `curl` of a
   recorded URL (expect 404).
8. `pnpm preview:check` → all green. Revoke the Vercel token.
9. Merge this PR, then land the **closeout commit**: flip the preview migrate job's `exit 0` →
   `exit 1` (the skip is deliberately temporary) and tick OPS-1 in `docs/plan.md`.

Plus two standing entries: the **reset** recipe for the preview project (drop → re-create → migrate →
seed; run it before a demo, after a deletion rehearsal, or whenever a reviewer entered values), and
the **fork-preview incident** line (if a fork preview ever builds, rotate the preview credentials and
purge that deployment).

## Test plan

**Unit (`pnpm test`, `packages/shared/src/db-environment.test.ts`):**

- `vercelEnv` unset + local host → passes, for every shape the repo actually produces: the embedded
  Postgres string, `ci.yml`'s build placeholder, the e2e service string, `vitest.config.ts`'s value.
- `vercelEnv` unset + a Neon host, no opt-in → **throws** (the fail-closed case the panel added).
- same + `allowLiveDb` → passes (`pnpm dev:prod`).
- `vercelEnv='preview'` + a production-named database → throws. **This is today's configuration.**
- `vercelEnv='production'` + a preview-named database → throws.
- `vercelEnv='development'` + a production-named database → throws (the third scope).
- `vercelEnv='preview'` + `mat_plan_preview` → passes; `'production'` + `neondb` → passes.
- a custom-environment slug → treated as non-production, so the preview rule applies.
- unparseable URL, and a URL with **no database path** (`postgres://u:p@h` and `postgres://u:p@h/`
  both parse to an empty name) → throw, fail closed.
- `assertMigrationTarget` in both directions.
- **Message contract:** every throw asserted by **equality** against its exported constant, with the
  constant set pinned so adding a message forces a test edit; no message contains any value derived
  from `DATABASE_URL`.

**Guard self-test (`pnpm guards:test`, offline):** all-pass; fork protection false; fork-protection
field missing (exit 2, not 1); `autoExposeSystemEnvs` false; one `DATABASE_URL` record targeting
several scopes (today's shape); a record sharing `production` + `development`; `SKIP_ENV_VALIDATION`
present; `DATABASE_URL` missing from Preview; a `SHAREABLE`-allowlisted variable shared (passes);
unparseable API response → exit 2; a `--snapshot` path inside the tree → refused; and assertions that
the script builds no `/env/`-per-id URL and echoes no snapshot value.

**CI:** `pnpm verify`, `pnpm guides:check`, `pnpm actions:check` green; `next build` green with
`VERCEL_ENV` unset and a localhost `DATABASE_URL`, proving the locality rule does not break CI.

**Live (the maintainer, from the runbook):** `pnpm preview:check` green; a preview URL accepts the
**preview** gate code and rejects the production one; the preview Today view shows seed data only; a
recorded historical preview URL now 404s.

## Risks / rollback

| Risk                                                                                                                | Mitigation                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merging could break the **production** build if production's database name happened to contain `preview`.           | Runbook step 0a checks it before anything else. Neon's default name is `neondb`; if it were otherwise, the token in the shared module changes first. Verified locally that a correct production pairing (`neondb` + `VERCEL_ENV=production`) builds green.                         |
| After merge, an open PR's preview build fails until the Preview scope is split — Dependabot's included.             | The runbook runs **before** the merge and pre-merge code reads none of the new variables, so the window is zero if the order is followed. If it is not, the failure is a red preview build, not a data incident.                                                                   |
| The locality rule makes **every** build fail if Vercel's system env vars are off.                                   | Correct and deliberate — fail closed. The message names the toggle, step 0 confirms it, `preview:check` asserts it.                                                                                                                                                                |
| `pnpm dev:prod` would break (it targets live Neon on purpose).                                                      | It gets `ALLOW_LIVE_DB=1` in this PR. It is the only process in the repo that starts the app against a non-local database — verified by grepping every connection string the tooling builds; `screenshot --use-live-db` starts no server of its own and inherits the caller's env. |
| The preview database lags a PR's own migration.                                                                     | Identical to today. The e2e smoke is the pre-merge proof; a **local** migrate against the preview string is the escape hatch — never a branch `workflow_dispatch`, which this PR also guards against.                                                                              |
| The preview migrate job skips **green** when its secret is absent, so "previews are unmigrated" could go unnoticed. | Mirrors `migrate.yml`'s existing guard, so the maintainer only adds a secret. The skip is explicitly temporary: a `tech-debt.md` entry with a payoff trigger, and the runbook's closeout commit flips it to `exit 1`.                                                              |
| The verification script's self-test proves the parser, **not** Vercel's API contract.                               | Stated plainly, here and in the script header. Frozen snapshots cannot detect that the live API changed shape; only a live run can, and that happens when the maintainer runs the runbook. No claim otherwise.                                                                     |
| The preview database holds the seed's fixture profiles, including two minors' first names.                          | A second copy, written down as one (`service-setup.md`, OPS-3's ledger), deletable by dropping a disposable project, and freed by the rename via the reset recipe. The names themselves are **OSS-1 follow-up #2**'s.                                                              |
| A reviewer's writes accumulate in a shared preview database with no lifetime.                                       | Declared disposable with a reset recipe and stated triggers. Also why no real family's data may ever reach it.                                                                                                                                                                     |
| A Vercel token with no read-only scope, on the maintainer's machine.                                                | Runbook hygiene: team-scoped, shortest expiry, `read -s`, revoked as the last step. Never in CI. Captures go to `.local-secrets/`; the script refuses an in-tree snapshot path.                                                                                                    |

**Rollback:** revert the PR, restore the Vercel scopes, and **delete the `mat-plan-preview` Neon
project** — it is rebuildable from `db:migrate` + `db:seed` in minutes, which is the whole point of
it, and leaving it live with nothing in the repo referencing it is exactly the orphaned copy a
deletion request misses. The rotations in step 7 are not rolled back, and should not be.

## Out-of-scope / deferred

- **OPS-2** — splitting `db:seed` into reference vs fixtures. Not required: the current seed already
  produces a seed-only database. **Two notes for OPS-2 to inherit:** both migrate workflows call
  `pnpm db:seed`, so after the split production wants `seedReference` and preview wants both — or the
  DoD's "preview deploy manually verified" box loses its subject; and **reference-only is what makes
  the preview project hold no personal data at all**, which is the privacy upside of doing OPS-2 next.
- **OSS-1 follow-up #2** — renaming the fixture profiles. Already a decided row; this PR adds
  `runbooks.md` to its sweep list and notes that the preview project picks the rename up by being
  reset, not by a second manual correction.
- **OPS-3** — the per-household restore drill. This PR tells its row there is a second data location.
- **Clerk.** Not wired until AUTH-1. The runbook pre-records the Preview-scope requirement (a separate
  Clerk **development** instance, `pk_test_`/`sk_test_`) as a step to perform _then_. No claim is made
  that Clerk is isolated today, because Clerk does not exist today.
- **Pointing the three existing connection-string parsers at the new shared module.** Mechanical, and
  it would double this diff's blast radius across the screenshot and dev harnesses.
- **A CI gate for `preview:check`**, and **per-PR preview databases.** Rejected above.
- **The Neon-branch migration rehearsal** that [tech-debt.md](../tech-debt.md) proposes: it plans to
  branch from `main` (production), which with a second family would clone their data into a
  CI-reachable database. When it is built it should branch the **preview** project or use an
  anonymized snapshot. Recorded so the proposal is not inherited unexamined.
- **Vercel Password Protection** and **Neon IP allowlisting** (both paid).

## Open questions

None blocking. Three the maintainer answers while executing the runbook: whether Preview gets its own
Sentry project or simply no DSN (recommended: **no DSN** — preview errors reproduce locally, and a
shared DSN mixes preview noise into the production inbox, which the row forbids anyway); whether both
DB secrets move into a `main`-only GitHub Environment (recommended, not required); and what Deployment
Protection this account offers, which step 0 records rather than guesses.

## Review-response log (adversarial panel)

Six lenses, run in parallel on the first draft, before any implementation code. Every BLOCKING and
SHOULD critique has a verdict.

### Engineering + security panel (round 1)

| #          | Lens                                  | Critique (short)                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verdict                                 | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1         | Scope                                 | **BLOCKING** — `DATA_ENVIRONMENT` catches nothing a `VERCEL_ENV`-keyed rule doesn't, and is the sole cause of the "merging breaks production" risk                                                                                                                                                                                                                                                                                                    | **accepted**                            | The variable is **gone**. One rule, keyed on `VERCEL_ENV`. Removes a var from three Vercel scopes, removes the pre-merge ordering hazard, removes two script checks, halves the test matrix. The single biggest improvement in the round.                                                                                                                                                                                             |
| C1         | Correctness                           | **BLOCKING** — a `VERCEL_ENV`-keyed rule is fail-**open**: `VERCEL_ENV` sits behind Vercel's `autoExposeSystemEnvs` toggle, so the guard silently no-ops if it is off                                                                                                                                                                                                                                                                                 | **accepted**                            | Added the locality rule: `VERCEL_ENV` absent + a non-local database ⇒ throw, unless `ALLOW_LIVE_DB=1`. The guard no longer depends on the toggle at all; `preview:check` asserts the toggle too. Confirmed against Vercel's docs. **Two lenses pulling opposite ways produced a guard stronger than either draft.**                                                                                                                   |
| SEC1       | Security                              | **BLOCKING** — ~100 historical preview deployments are live, publicly listed via the GitHub deployments API, and keep the **production** DB string and gate code                                                                                                                                                                                                                                                                                      | **accepted**                            | Independently re-verified (100 listed; recent ones HTTP 200). Runbook step 7: purge + rotate the production gate code **and the Neon role password** + redeploy, with the "rotation is not retroactive" note and a done-when item. **This is the finding the backlog row itself misses.**                                                                                                                                             |
| C2/A1/SEC2 | Correctness · Architecture · Security | **BLOCKING ×3** — the documented `workflow_dispatch` escape hatch would apply an unmerged branch's migrations to **production**                                                                                                                                                                                                                                                                                                                       | **accepted, different fix**             | The preview migrator is its **own workflow file**, so the production credential is not even present in a branch dispatch — strictly safer than input-gating one workflow, and it avoids renaming `migrate.yml` (which several docs reference by name, and whose `concurrency` group would have become a misnomer). Plus `if: github.ref == 'refs/heads/main'` on the production job, and the escape hatch is now a **local** migrate. |
| C3/SEC3    | Correctness · Security                | **BLOCKING ×2** — `SKIP_ENV_VALIDATION` is a one-click silent kill switch, and this PR creates the pressure to use it                                                                                                                                                                                                                                                                                                                                 | **accepted**                            | The assert is **unconditional**, reading `process.env` directly, outside the skip gate. `preview:check` fails if the variable exists in any scope. The runbook says the unblock move is fixing the scope, never skipping validation.                                                                                                                                                                                                  |
| C4/SEC4/A2 | Correctness · Security · Architecture | **BLOCKING ×3** — the migrator has no guard, so a mis-pasted secret DDLs production; the inverse makes production silently stop migrating, green                                                                                                                                                                                                                                                                                                      | **accepted**                            | `assertMigrationTarget` in `migrate.ts` + `seed.ts`, keyed on `EXPECTED_DB_ENV`, set by each workflow. This is why the rule moved to `packages/shared`.                                                                                                                                                                                                                                                                               |
| A3/R1      | Architecture · Reuse                  | **SHOULD ×2** — the rule belongs in `packages/shared`; "only one package reads it" is false                                                                                                                                                                                                                                                                                                                                                           | **accepted**                            | Moved. The honest reason is theirs: `packages/db` is a real second consumer across a package boundary.                                                                                                                                                                                                                                                                                                                                |
| R2         | Reuse                                 | **BLOCKING** — a hand-maintained credential list in the script drifts **invisibly** (omitted var ⇒ never asserted ⇒ all-green)                                                                                                                                                                                                                                                                                                                        | **accepted**                            | The per-credential check is gone. The structural sharing check is list-free and covers variables nobody enumerated.                                                                                                                                                                                                                                                                                                                   |
| A4         | Architecture                          | **SHOULD** — a blanket "nothing shared" check will false-fail on AUTH-1's legitimately shared `NEXT_PUBLIC_CLERK_*` constants; drive it off a named list                                                                                                                                                                                                                                                                                              | **accepted in substance, fix inverted** | A denylist of secrets fails **open** on omission (R2); an allowlist fails **closed**. So: fail on every shared variable, with an explicit **empty** `SHAREABLE` allowlist requiring a commented entry. Only this shape satisfies both critiques; the reasoning is now in the plan.                                                                                                                                                    |
| SEC5       | Security                              | **SHOULD** — "no part of `DATABASE_URL` in the message" is specified three incompatible ways, and `not.toContain(password)` is a denylist that passes vacuously                                                                                                                                                                                                                                                                                       | **accepted**                            | One contract: every throw is an exported constant interpolating only `vercelEnv`; **no** value derived from `DATABASE_URL`, the database name included. Tested by **equality**, constant set pinned. The messages carry the rule instead of the value.                                                                                                                                                                                |
| SEC6       | Security                              | **SHOULD** — the "no Vercel token in CI" argument is understated; the local token's hygiene is unspecified; `decrypt` is deprecated so don't rest the claim on it                                                                                                                                                                                                                                                                                     | **accepted**                            | Restated: Vercel tokens have **no read-only scope** and can decrypt every production variable. Hygiene in the runbook. The claim now rests on never calling the per-id `/env/{id}` endpoint, asserted by the self-test.                                                                                                                                                                                                               |
| SEC7       | Security                              | **SHOULD** — fork protection: the threat is unstated, and `gitForkProtection` is optional so the check can be unfixably red                                                                                                                                                                                                                                                                                                                           | **accepted**                            | Threat written in (a fork **build** reaching the Preview scope's env, not a fork reading data). Runbook step is "toggle off, save, on, save". Standing rotation line added.                                                                                                                                                                                                                                                           |
| SEC8       | Security                              | **SHOULD** — residual risks unnamed: previews are publicly _listed_, the gate is **unrate-limited** without Upstash, `/api` is ungated, Neon has no IP allowlist                                                                                                                                                                                                                                                                                      | **accepted**                            | New "Residual risk after this PR" section. Upstash for Preview is now a **runbook step, not an option**, and the preview gate code must be long and random.                                                                                                                                                                                                                                                                           |
| SEC9       | Security                              | **SHOULD** — the preview job's green skip is itself a claimed-but-unwired gate                                                                                                                                                                                                                                                                                                                                                                        | **accepted**                            | `tech-debt.md` entry with a payoff trigger; the closeout commit flips `exit 0` → `exit 1`; done-when reworded so it does not read as finished.                                                                                                                                                                                                                                                                                        |
| C5         | Correctness                           | **SHOULD** — all the dashboard work is pre-merge-safe, so the broken window can be **zero**                                                                                                                                                                                                                                                                                                                                                           | **accepted**                            | Runbook reordered: every dashboard step precedes the merge, and the plan says why that is safe.                                                                                                                                                                                                                                                                                                                                       |
| C6         | Correctness                           | **SHOULD** — an **empty** database name passes a `production` declaration (`postgres://u:p@h` parses to `''`)                                                                                                                                                                                                                                                                                                                                         | **accepted**                            | Non-empty is part of the fail-closed rule, with both shapes as test cases. Verified by running the extraction.                                                                                                                                                                                                                                                                                                                        |
| A5/R3      | Architecture · Reuse                  | **SHOULD ×2** — the doc sweep misses `AGENTS.md`:307, `service-setup.md`'s "Nothing else" secrets table, and `deploy.md`'s canonical environments table                                                                                                                                                                                                                                                                                               | **accepted**                            | All three added. `AGENTS.md` matters most: the file every session reads first was asserting the same unwired gate.                                                                                                                                                                                                                                                                                                                    |
| R4         | Reuse                                 | **SHOULD** — the runbook would become a second home for Vercel wiring, which `runbooks.md`:210 already points at `deploy.md` for                                                                                                                                                                                                                                                                                                                      | **accepted**                            | Split by kind: **wiring** → `deploy.md`; **the procedure to execute and confirm** → `runbooks.md`, shaped like the existing "Verifying V1-14a hardening" section.                                                                                                                                                                                                                                                                     |
| R5         | Reuse                                 | **SHOULD** — the repo has three copies of "parse a URL, fail closed, never echo it", and the plan mentions none                                                                                                                                                                                                                                                                                                                                       | **accepted**                            | All three named, with the reason this adds no fourth and the reason they are not migrated here.                                                                                                                                                                                                                                                                                                                                       |
| R6         | Reuse                                 | **SHOULD** — adopt the house exit-code convention (0/1/2), not "exit 1 if any fails"                                                                                                                                                                                                                                                                                                                                                                  | **accepted**                            | 0 ok / 1 broken / 2 could-not-check, in the header's `Exit:` line, per `check-audit.mjs`'s hard-won split.                                                                                                                                                                                                                                                                                                                            |
| R7         | Reuse                                 | **SHOULD** — the guard breaks `runbooks.md`'s V1-14a Sentry trigger, and that section is not in the edit list                                                                                                                                                                                                                                                                                                                                         | **accepted**                            | Added, with their replacement trigger (`postgres://u:p@127.0.0.1:1/mat_plan_preview` — parses, names a preview DB, fails at connect).                                                                                                                                                                                                                                                                                                 |
| S2         | Scope                                 | **SHOULD** — drop `db:seed` from the preview job: OPS-1 needs only a _migrated_ database                                                                                                                                                                                                                                                                                                                                                              | **rejected, reframed**                  | A migrate-only preview has no reference rows and no profiles, so every preview lands on the broken first-run screen (`ONB-0`, an open P0) and the DoD box loses its subject. But the privacy lens was right that "not required, not absorbed" was the wrong framing: it is now recorded as a **sequencing choice with a named cost**, and reference-only is named as OPS-2's upside.                                                  |
| S3         | Scope                                 | **SHOULD** — defer `preview:check`: ~300 lines, not a gate, run once, and its drift detector cannot detect drift                                                                                                                                                                                                                                                                                                                                      | **partly accepted**                     | The drift claim is **accepted and restated honestly**. The deferral is **rejected**: it is the only mechanical check of the row's _credential_ half and of fork protection, and shipping the row with no verification is how this repo acquired four claimed-but-unwired gates. It did shrink — five list-free checks after R2/S1.                                                                                                    |
| S4         | Scope                                 | **SHOULD** — five concerns, ~16 files, no size statement, no split discussion                                                                                                                                                                                                                                                                                                                                                                         | **partly accepted**                     | The size statement and the cut-line are now in the plan; that omission was fair and every comparable plan here states it. The split is **rejected**: the guard, the verification and the procedure are one concern, and a docs-only PR saying "previews are not isolated, and here is no fix" is worse than the combined one.                                                                                                         |
| S5         | Scope                                 | **SHOULD** — "done when" records a pending state in the one document convention never retro-edits                                                                                                                                                                                                                                                                                                                                                     | **accepted**                            | The outstanding dashboard half now lives in `docs/plan.md` and `docs/status.md`; the plan links there.                                                                                                                                                                                                                                                                                                                                |
| NITs       | all                                   | `VERCEL_ENV` as `z.string().optional()` · crafted-only fixtures · don't paste `preview:check` output into a public PR · name the Development scope and `assertLocalDbUrl` · `apps/web/vercel.json` on the `screenshots` orphan branch · embed the updated `architecture.md` §5 topology in the PR · the OPS-2 seed-split seam note · `preview:check` named for the `<thing>:check` family · the `gitBranch`-scoped-record nuance in the script header | **accepted**                            | All folded in. One NIT **rejected**: renaming `migrate.yml`'s concurrency group, moot now that the preview migrator is its own file.                                                                                                                                                                                                                                                                                                  |

### Privacy panel (round 2)

Run after the engineering round because this PR **creates a second copy of personal data** and adds a
third-party call — two of the triggers `AGENTS.md` names for this lens.

| #   | Critique (short)                                                                                                                                                                                                            | Verdict                     | Resolution                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **BLOCKING** — the fixture-name problem is **OSS-1 follow-up #2**'s, not OPS-2's; and a rename is fresh-DB-only (`onConflictDoNothing`), so seeding a second project makes the rename need a manual correction per database | **accepted; cost rebutted** | Attribution corrected, and `runbooks.md` added to that row's sweep list (it embeds the same name in committed SQL, and the row listed only three files). The "more expensive" half is **answered rather than accepted**: because the preview project is declared **disposable**, the rename reaches it by dropping and re-seeding, not by a second correction. That is now a stated design property. |
| P2  | **BLOCKING** — "there is nothing to purge" is wrong: every preview build ran with production credentials, and nothing rotates them                                                                                          | **accepted**                | Converges with SEC1. Step 7 now rotates the production gate code **and** the Neon production role password (propagating to Vercel Production and the GitHub secret), and the "nothing to purge" sentence is gone. It also fills in `runbooks.md`'s "Rotate a secret" TODO for this case.                                                                                                             |
| P3  | **SHOULD** — the preview DB does not hold "seed data only" after the first preview, nothing resets it, and the seed **re-creates** a profile soft-deleted while rehearsing deletion                                         | **accepted**                | The project is **declared disposable**, with a reset recipe and stated triggers in the runbook. The failure table now says "seed data **plus whatever previews wrote**". The deletion-rehearsal interaction is a genuinely sharp catch.                                                                                                                                                              |
| P4  | **SHOULD** — rollback calls an orphaned database holding personal data "harmless", and no document records the second location                                                                                              | **accepted**                | Rollback **deletes** the Neon project. The preview project is registered in `service-setup.md` and in OPS-3's deletion-ledger row, as a new done-when item. "Harmlessly" is deleted.                                                                                                                                                                                                                 |
| P5  | **SHOULD** — the script asserts nothing about the **Development** scope, which holds the same production values; a `production`+`development` record would pass all-green                                                   | **accepted**                | The sharing check became "no record shares `production` with **any** other target". The app guard already covers it: anything not `production` must name a preview database. The Goal named three scopes and the checks covered two — exactly the narrowing this plan exists to stop.                                                                                                                |
| P6  | **SHOULD** — `--snapshot`'s capture path has no stated destination, and the token no stated scope or lifetime                                                                                                               | **accepted**                | Committed snapshots are crafted only; a capture goes to the gitignored `.local-secrets/`; **the script refuses a snapshot path resolving inside the working tree**; the token is team-scoped, shortest expiry, `read -s`, revoked last.                                                                                                                                                              |
| P7  | **SHOULD** — "Deployment Protection is a paid feature" conflates Vercel Authentication with Password Protection, dismissing the one control that answers "who can reach a preview"                                          | **accepted**                | The plan no longer asserts which tier is free (unverifiable from here). Runbook step 0 **records what the account offers and what is set**, with the real trade-off named: SSO-gated previews lock out a reviewer without Vercel access, which touches the DoD box.                                                                                                                                  |
| P8  | **NIT** — migrate-only is the wrong answer, but "not required, not absorbed" has the OPS-2 relationship inverted                                                                                                            | **accepted**                | Reframed as a sequencing choice with a named cost; reference-only is identified as the right middle and as OPS-2's privacy upside. Folded together with S2.                                                                                                                                                                                                                                          |
