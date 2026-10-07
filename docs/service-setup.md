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

| Service           | Purpose                       | Required?                        | Blocks                       |
| ----------------- | ----------------------------- | -------------------------------- | ---------------------------- |
| **Neon**          | Postgres                      | ✅ **Required** — app won't boot | everything                   |
| **Vercel**        | Hosting + preview deploys     | ✅ **Required**                  | deploys                      |
| **GitHub**        | Repo, CI, the single migrator | ✅ **Required**                  | CI, migrations               |
| **Upstash Redis** | Rate-limits the access gate   | ⬜ Optional                      | nothing — no-ops when absent |
| **Sentry**        | Server error reporting        | ⬜ Optional                      | nothing — no-ops when absent |

**The two optional ones are genuinely optional.** V1-14a was deliberately built so that an absent
credential means the feature no-ops and the app behaves exactly as it did before. That is not a
convenience — local dev, CI, and previews all legitimately run without them, and requiring them would
have broken `pnpm dev` and CI the day it merged.

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
to on** (request bodies, headers, cookies, DB query data, AI prompts; stack-frame locals too, if
`includeLocalVariables` is ever enabled). `SENTRY_DATA_COLLECTION` in `lib/sentry-scrub.ts` turns each
one off. The scrubber in the same file is a second line for the dangerous subset: request bodies and
Server Action results, frame locals, cookies, credential headers and query strings. Both are
unit-tested. **Run the verification pass in [runbooks.md](./runbooks.md) after wiring** — if a cookie
or a bodyweight ever appears in a Sentry event, treat it as an incident: revoke the DSN and rotate
`ACCESS_GATE_PASSWORD`.

---

## 3. Where every value goes

### Vercel — Project → Settings → Environment Variables

| Variable                         | Production | Preview | Development |
| -------------------------------- | :--------: | :-----: | :---------: |
| `ACCESS_GATE_PASSWORD`           |     ✅     |   ✅    |     ✅      |
| `DATABASE_URL` (Neon **pooled**) |     ✅     |   ✅    |     ✅      |
| `UPSTASH_REDIS_REST_URL`         |     ✅     |   ✅    |     ✅      |
| `UPSTASH_REDIS_REST_TOKEN`       |     ✅     |   ✅    |     ✅      |
| `SENTRY_DSN`                     |     ✅     |   ✅    |     ✅      |

`DATABASE_URL_UNPOOLED` does **not** go in Vercel — Vercel never migrates.

### GitHub — Settings → Secrets and variables → Actions

| Secret                                    | Why                                   |
| ----------------------------------------- | ------------------------------------- |
| `DATABASE_URL_UNPOOLED` (Neon **direct**) | GitHub Actions is the single migrator |

**Nothing else.** CI deliberately has no Upstash or Sentry credentials, so that no external service
outage can redden a build. If a CI failure ever mentions either, something was added here that
shouldn't have been.

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

| Service                   | When                                      | For                                                                                                   |
| ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Clerk**                 | v1.5                                      | household login; replaces the access-gate stopgap and finally makes per-user rate limiting meaningful |
| **Anthropic API**         | AI-1                                      | natural-language logging                                                                              |
| **Vercel Speed Insights** | later                                     | Core Web Vitals RUM ([ADR-0001](./decisions/0001-observability-and-web-vitals.md))                    |
| **Axiom / Better Stack**  | later, only if Sentry proves insufficient | log drain                                                                                             |
