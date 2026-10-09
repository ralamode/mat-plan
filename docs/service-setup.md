# Service & credential setup

Every external account this app uses, what each one unblocks, exactly which values to copy, and where
each value goes. Written as a checklist so it can be worked through in one sitting.

**Two rules that apply to everything below:**

- **Never paste a credential into a chat, PR, issue, or commit.** Set values directly in the provider's
  dashboard. `.env*` and `.local-secrets/*` are gitignored (see [tech-debt](./tech-debt.md) for the one
  gitignore bug that got past this, now fixed).
- **Account recovery codes go in `.local-secrets/`**, env vars go in `apps/web/.env.local` — see that
  folder's README for the distinction.

Related: [deploy.md](./deploy.md) (the deployment topology), [.github/SECURITY.md](../.github/SECURITY.md).

---

## Status at a glance

| Service           | Purpose                       | Required?                               | Blocks                                         |
| ----------------- | ----------------------------- | --------------------------------------- | ---------------------------------------------- |
| **Neon**          | Postgres                      | ✅ **Required** — app won't boot        | everything                                     |
| **Vercel**        | Hosting + preview deploys     | ✅ **Required**                         | deploys                                        |
| **GitHub**        | Repo, CI, the single migrator | ✅ **Required**                         | CI, migrations                                 |
| **Upstash Redis** | Rate-limits the access gate   | ✅ **Required** in every deployed scope | brute-force protection — fails open without it |
| **Sentry**        | Server error reporting        | ⬜ Optional                             | nothing — no-ops when absent                   |

### Where personal data lives

Two places, since OPS-1 — written down here because an unrecorded copy is the one a deletion request
misses, and OPS-3's deletion ledger has to walk both:

| Location                     | Holds                                                                                                                                       | Who can read it                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Neon, production project** | the real thing — profiles, bodyweight, every logged entry                                                                                   | the household operator, through the app           |
| **Neon, `mat-plan-preview`** | `db:seed`'s fixture profiles (**two minors' first names**, already public in `packages/db/src/seed.ts`) **plus whatever any preview wrote** | anyone with the preview gate code; the maintainer |

The preview project holds **no real family's logged data** and must never be allowed to: a preview is
publicly listed and internet-reachable. It is **disposable** — [runbooks.md](./runbooks.md) → OPS-1
has the reset recipe, and deleting the project is the complete deletion path for that copy. The
fixture names themselves are **OSS-1 follow-up #2**'s row, not OPS-1's; reference-only seeding, which
would remove them from this table entirely, is **OPS-2**'s.

**Sentry is genuinely optional, and Upstash is optional only off Vercel.** V1-14a was deliberately
built so that an absent credential means the feature no-ops and the app behaves exactly as before.
That is right for local dev and CI, which legitimately run without them.

⚠️ **On Vercel, Upstash is required in every scope.** Without it the rate limiter fails **open**, so
the access gate (the app's only control before AUTH-1) becomes an **unlimited** password oracle. That
is not hypothetical: **production ran with no Upstash database until 2026-10-09**, while this file
called it optional and `tech-debt.md` said the gate was rate limited. The no-op that makes CI work is
the same no-op that hid it. Preview URLs are also publicly listed (the GitHub deployments API exposes
`environment_url` on a public repo), which is why Preview needs its own database too.

---

## 1. Upstash Redis — gate rate limiting

**What it buys:** the access gate is the app's only unauthenticated password oracle, guarding the only
shared secret. Without this, someone who finds the URL can guess the code as fast as they can send
requests. With it, ~10 attempts per 10 minutes per IP.

**Without it:** the gate is unlimited, exactly as it was before V1-14a. Nothing else changes.

### Steps

1. Sign up at **[console.upstash.com](https://console.upstash.com)**.
2. **Create Database** → type **Redis**.
   - **Name:** `mat-plan-ratelimit`
   - **Region:** match your Vercel region (`us-east-1` / `iad1` unless you changed it). Wrong region =
     an extra ~80ms on every gate submit.
   - **Type:** Regional (not Global — you have one region and Global costs more).
   - Free tier: 10k commands/day. A household uses a handful per week.
3. Open the database → **REST API** tab → copy two values:

| Copy this                  | Looks like                         |
| -------------------------- | ---------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | `https://us1-xxx-12345.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | a long opaque token                |

> ⚠️ Copy from the **REST API** tab, not the "Redis connect" tab. The `redis://…` connection string is a
> different protocol and will not work — `@upstash/redis` speaks REST over HTTPS so it can run in a
> serverless function without a TCP pool.

4. Save the account's **2FA recovery codes** to `.local-secrets/upstash-recovery-codes.txt`.

---

## 2. Sentry — server error reporting

**What it buys:** today an unexpected server exception renders `error.tsx` and **vanishes** — there is no
record it happened. With a DSN, it lands in an inbox with a stack trace.

**Without it:** errors keep vanishing. No behaviour change.

### Steps

1. Sign up at **[sentry.io](https://sentry.io)**.
2. **Create Project** → platform **Next.js** → name `mat-plan`. Free tier: 5k errors/month.
3. **Settings → Projects → mat-plan → Client Keys (DSN)** → copy the **DSN**:

| Copy this    | Looks like                                         |
| ------------ | -------------------------------------------------- |
| `SENTRY_DSN` | `https://abc123@o12345.ingest.us.sentry.io/678901` |

4. Save 2FA recovery codes to `.local-secrets/sentry-recovery-codes.txt`.

### You do NOT need an auth token, org slug, or project slug

Source-map upload is deliberately disabled. It requires `@sentry/cli`, whose postinstall pulls a ~20MB
binary into **every** install including CI, which never uploads anything — the same cost already logged
against `embedded-postgres`. **Trade-off:** Sentry stack frames will be minified. That's a legibility
cost on a three-user app, and it's reversible: flip `sourcemaps.disable` in `next.config.ts` **and**
`'@sentry/cli'` in `pnpm-workspace.yaml` together, then add the three extra vars. See
[tech-debt.md](./tech-debt.md).

### ⚠️ A DSN is not secret, but treat the data as privileged

The DSN is embeddable by design. What matters is what gets **sent**: the naive Sentry wiring would have
shipped the `mp_gate` cookie, a kid's bodyweight, and the plaintext access code to Sentry.
Since Sentry 11 the SDK's `dataCollection` option decides what it gathers, and **every field defaults
to on** (request bodies, headers, cookies, DB query data, stack-frame locals, AI prompts).
`SENTRY_DATA_COLLECTION` in `lib/sentry-scrub.ts` turns each one off, and the scrubber in the same file
strips the same things again as a second line. Both are unit-tested. **Run the verification pass in [runbooks.md](./runbooks.md) after wiring** — if a cookie
or a bodyweight ever appears in a Sentry event, treat it as an incident: revoke the DSN and rotate
`ACCESS_GATE_PASSWORD`.

---

## 3. Where every value goes

### Vercel — Project → Settings → Environment Variables

⚠️ **This table used to be ✅/✅/✅ on every row — one value per variable across all three scopes.**
That is what OPS-1 fixed: it meant a preview deployment of any pull request read and wrote
**production**, with the production gate code. **No variable may target more than one scope.** Give
each scope its own record, even where the value is identical.

| Variable                   | Production                  | Preview                    | Development            |
| -------------------------- | --------------------------- | -------------------------- | ---------------------- |
| `ACCESS_GATE_PASSWORD`     | its own long random code    | a **different** one        | same as Preview        |
| `DATABASE_URL` (pooled)    | the production Neon project | **`mat-plan-preview`**     | **`mat-plan-preview`** |
| `UPSTASH_REDIS_REST_URL`   | the production Redis DB     | a **second**, preview-only | same as Preview        |
| `UPSTASH_REDIS_REST_TOKEN` | the production Redis DB     | the same second DB         | same as Preview        |
| `SENTRY_DSN`               | ✅                          | ⬜ **unset**               | ⬜ **unset**           |
| `SKIP_ENV_VALIDATION`      | ⛔ never                    | ⛔ never                   | ⛔ never               |
| `ALLOW_LIVE_DB`            | ⛔ never                    | ⛔ never                   | ⛔ never               |

`DATABASE_URL_UNPOOLED` does **not** go in Vercel — Vercel never migrates.

**Development gets the preview string**, not production's: `vercel env pull` would otherwise hand a
laptop read-write production credentials, and `pnpm dev` uses an embedded Postgres and never reads
it. The two ⛔ rows are not style: `SKIP_ENV_VALIDATION` turns off env validation including OPS-1's
database guard, and `ALLOW_LIVE_DB` is the deliberate off-Vercel opt-in for `pnpm dev:prod`.

Verify it mechanically with `pnpm preview:check`. The ordered procedure —including the **purge of
historical previews** and the credential **rotation** they force— is
[runbooks.md](./runbooks.md) → OPS-1.

### GitHub — Settings → Secrets and variables → Actions

| Secret                                            | Why                                                   |
| ------------------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL_UNPOOLED` (Neon **direct**)         | `migrate.yml` — GitHub Actions is the single migrator |
| `PREVIEW_DATABASE_URL_UNPOOLED` (preview project) | `migrate-preview.yml` — the preview estate's migrator |

**Those two, and nothing else.** CI deliberately has no Upstash or Sentry credentials, so that no
external service outage can redden a build. If a CI failure ever mentions either, something was added
here that shouldn't have been.

**No Vercel token, either** — deliberately. `pnpm preview:check` needs one, and a Vercel token is
account- or team-scoped with **no read-only scope**: it can decrypt every production environment
variable and create deployments. On a public repo that is a worse risk than the one it verifies, so
the check is a local command the runbook invokes and then revokes.

Both database secrets are reachable only from `push: [main]` and `workflow_dispatch`, so **a fork PR
never sees either**. _(Optional hardening: move them into a GitHub Environment with a `main`-only
deployment-branch policy, so a future workflow cannot reference them by accident.)_

### Local — `apps/web/.env.local` (gitignored)

| Variable                                 | Needed?                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `ACCESS_GATE_PASSWORD`                   | ✅ any ≥8 chars                                                 |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | only when targeting Neon — `pnpm dev` uses an embedded Postgres |
| `UPSTASH_*`, `SENTRY_DSN`                | ❌ leave unset; both no-op                                      |

### `.local-secrets/` (gitignored except its README)

Account-recovery material only — **not** env vars: `vercel-recovery-codes.txt`,
`neon-recovery-codes.txt`, `upstash-recovery-codes.txt`, `sentry-recovery-codes.txt`.

---

## 4. Verify

After wiring, run the manual pass in **[runbooks.md](./runbooks.md)** — it is the only way to confirm
these actually work, because neither can be verified without live credentials. In short:

1. Trigger a deliberate error on the **preview** deploy → confirm it reaches Sentry **with no cookie and
   no bodyweight in the payload**.
2. Submit a wrong access code 11 times in 10 minutes → expect "Too many attempts. Try again in a few
   minutes." **rendered in the form**, not an error page.
3. Set a deliberately bogus Upstash token → the gate must still **work** (it fails open by design; a
   Redis outage locking you out of your own log is worse than a briefly wider guess window).

---

## 5. Not needed yet

| Service                   | When                                      | For                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clerk**                 | Beta 0 (AUTH-1)                           | household login; replaces the access-gate stopgap and finally makes per-user rate limiting meaningful. **Two instances:** a production one, and a **development** instance (`pk_test_`/`sk_test_`) for the Preview scope — OPS-1's rule is that the Preview scope holds no production secret |
| **Anthropic API**         | AI-1                                      | natural-language logging                                                                                                                                                                                                                                                                     |
| **Vercel Speed Insights** | later                                     | Core Web Vitals RUM ([ADR-0001](./decisions/0001-observability-and-web-vitals.md))                                                                                                                                                                                                           |
| **Axiom / Better Stack**  | later, only if Sentry proves insufficient | log drain                                                                                                                                                                                                                                                                                    |
