import 'server-only';

import { assertDatabaseEnvironment, isLocalDbHost } from '@mat-plan/shared';
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Validated environment (V0-4). This is the single place `process.env` is read
 * (per AGENTS.md: no `process.env` outside the DAL / this module). Validation
 * runs at import time, so the server **refuses to boot** on a missing/invalid
 * var rather than failing deep in a request. Add new vars here + `.env.example`.
 *
 * `SKIP_ENV_VALIDATION=1` bypasses validation for tooling that never runs the
 * app (e.g. Docker image builds); real deploys always validate. **OPS-1's
 * database-environment guard at the bottom of this file deliberately runs
 * OUTSIDE that gate** — see the comment there.
 */
/**
 * The shape a bypass principal must have. **Used in three places on purpose** — the zod schema, the
 * boot refusal and the reader — because it is a CONTROL, not hygiene, and only one of those three is
 * inside `createEnv`.
 *
 * 🔴 **`SKIP_ENV_VALIDATION` disables zod, so the schema alone does not enforce it.** With that flag
 * set, a value like `'  not-a-clerk-id  '` would otherwise reach `checkMutationLimit(userId)` as a
 * Redis key and, at 1c-4, a `membershipHousehold()` lookup. The refusal and the reader apply it
 * themselves, which is the same doctrine the OPS-1 guard below follows for the same reason.
 */
const BYPASS_ID_RE = /^user_[A-Za-z0-9]+$/;

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Access-gate stopgap shared code — see lib/access-gate.ts. NOT an auth boundary.
    ACCESS_GATE_PASSWORD: z.string().min(8, 'ACCESS_GATE_PASSWORD must be at least 8 characters.'),
    // Pooled Neon string (PgBouncer) for app runtime on the Node runtime. Migrations
    // use the DIRECT/unpooled string via drizzle-kit (tooling), not this app env.
    DATABASE_URL: z.string().url(),

    // --- OPS-1: which estate this deployment is wired to. ---
    // Vercel SYSTEM variables, set by the platform at build and runtime; absent off Vercel.
    // `VERCEL_ENV` is deliberately a loose string, not an enum: a Vercel *custom environment*
    // reports its own slug, and that should surface as the guard's named error (which says what to
    // fix) rather than as a generic "Invalid environment variables" from zod.
    // This is also the var ADR 0001 §1 asks for, for the later Speed Insights gate — reuse it
    // there rather than adding a second "am I production?" variable.
    VERCEL_ENV: z.string().optional(),
    // The deliberate opt-in that lets an OFF-VERCEL process target a non-local database:
    // `pnpm dev:prod` and `screenshot:ephemeral --use-live-db`. Nothing else should set it, and it
    // must never be set in a Vercel scope.
    ALLOW_LIVE_DB: z.string().optional(),

    // --- V1-14a hardening. ALL OPTIONAL BY DESIGN. ---
    // Three environments legitimately run without these: local dev (`pnpm dev`), CI (no external
    // service may gate a build), and previews before the Vercel env is wired. Absent => the feature
    // no-ops and the app behaves exactly as it did before V1-14a. Making them required would break
    // `pnpm dev` and CI the day this merged.

    // Upstash Redis — rate limiting for the access gate only (see lib/rate-limit.ts).
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

    // Sentry error reporting. The DSN is the only var needed: source-map upload is deliberately
    // disabled (see next.config.ts + the @sentry/cli note in pnpm-workspace.yaml), so no auth token,
    // org or project slug is required.
    SENTRY_DSN: z.string().url().optional(),

    // --- AUTH-1 1a: Clerk, wired but DARK. BOTH OPTIONAL BY DESIGN. ---
    // Same rationale as the V1-14a block above, and the same three environments: local dev, CI
    // (`next build` runs with no external service) and un-wired previews legitimately run without
    // these. Absent => `proxy.ts` composes no `clerkMiddleware()`, `app/layout.tsx` renders no
    // `<ClerkProvider>`, and the app behaves exactly as it did before 1a. Making either REQUIRED
    // would break `pnpm dev` and CI the day 1a merged, and `lib/clerk.ts` is where the "both keys
    // present" predicate lives so the two call sites cannot disagree.
    //
    // ⚠️ Do NOT add a startup assertion that these exist. "Dark until the maintainer configures an
    // instance" is the deliberate state of chunks 1a-1b; 1c is the PR that makes a session the
    // boundary, and 1c is where `pnpm dev` starts needing dev keys in `.env.local`.
    CLERK_SECRET_KEY: z.string().min(1).optional(),

    // --- AUTH-1 1c-3a: the TEST SESSION BYPASS. Read `sessionBypassUserId()` below before touching.
    // Shaped like a real Clerk id on purpose: the principal it produces flows into
    // `checkMutationLimit(userId)` and, at 1c-4, `membershipHousehold(clerkUserId)`, so a boolean
    // flag would make the harness exercise a code path production never takes.
    // ⚠️ The regex is a CONTROL, not hygiene. `emptyStringAsUndefined` plus a shape turns `' '` into
    // a boot refusal; without it a whitespace principal becomes a Redis key and a membership lookup.
    E2E_SESSION_BYPASS_USER_ID: z.string().regex(BYPASS_ID_RE).optional(),
  },
  // ⚠️ `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the ONE legitimate `NEXT_PUBLIC_` in this repo.
  // AGENTS.md forbids the prefix on SECRETS; Clerk's publishable key is public by design — it is
  // shipped to every browser as the `data-clerk-publishable-key` attribute on Clerk's own script tag,
  // and Clerk's Frontend API is reachable with it by anyone. The secret half is `CLERK_SECRET_KEY`
  // above, which is server-only and never prefixed.
  //
  // Mechanical note: this module is `import 'server-only'`, so a client component cannot import
  // `env`. Declaring the key here therefore buys VALIDATION ONLY — `<ClerkProvider>` still receives
  // it through Next's build-time inlining of the `NEXT_PUBLIC_` prefix. Which means CI's `next build`
  // (no keys) inlines `undefined` and produces an artifact whose auth would fail in the BROWSER
  // rather than refusing on the server. That is exactly why `lib/clerk.ts` gates rendering on the
  // key's presence server-side instead of trusting the client to cope.
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    ACCESS_GATE_PASSWORD: process.env.ACCESS_GATE_PASSWORD,
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ALLOW_LIVE_DB: process.env.ALLOW_LIVE_DB,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    E2E_SESSION_BYPASS_USER_ID: process.env.E2E_SESSION_BYPASS_USER_ID,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

/**
 * OPS-1 — refuse to boot against the wrong database. Rule + reasoning:
 * `packages/shared/src/db-environment.ts`; procedure: docs/runbooks.md -> OPS-1.
 *
 * Until OPS-1, every Vercel scope shared one `DATABASE_URL`, so a preview deployment of any pull
 * request read and wrote production — two minors' logged bodyweight. This is what makes that
 * mis-wiring fail the BUILD instead of silently reaching production.
 *
 * **Called unconditionally, and read straight from `process.env` rather than from `env` above, for
 * two reasons that are the same reason.** `skipValidation` makes `createEnv` skip zod entirely — so
 * `env.DATABASE_URL` would be `undefined` while typed as a string — and, more importantly, leaving
 * this guard behind `SKIP_ENV_VALIDATION` would make one Vercel environment variable a silent kill
 * switch for the whole of OPS-1. A red build is exactly the moment someone reaches for that flag, so
 * `pnpm preview:check` additionally fails if it exists in any Vercel scope.
 *
 * This module is the one place allowed to read `process.env` (AGENTS.md), which is why the guard is
 * called here and lives as a pure function elsewhere.
 */
assertDatabaseEnvironment({
  vercelEnv: process.env.VERCEL_ENV,
  databaseUrl: process.env.DATABASE_URL,
  allowLiveDb: !!process.env.ALLOW_LIVE_DB,
  context: 'apps/web/lib/env.ts',
});

/**
 * AUTH-1 1c-3a — **is the test session bypass allowed to arm in this process?**
 *
 * The bypass lets `pnpm e2e:local`, `screenshot:ephemeral` and CI's smoke reach a page that calls
 * `requireSession()` with no Clerk keys and no egress to Clerk. It is an **authentication bypass in
 * production code**, so the gate is a POSITIVE proof that this is a throwaway harness.
 *
 * 🔴 **Keyed on database LOCALITY, not on `process.env.VERCEL`, and that is not a style choice.**
 * `VERCEL`/`VERCEL_ENV` are Vercel *system* variables, gated on the project's "Enable access to
 * System Environment Variables" toggle — `db-environment.ts` says so, and OPS-1 deliberately re-keyed
 * its own guard off locality for exactly this reason. A rule keyed on them silently no-ops when that
 * toggle is off, which for THIS control means a default-OPEN bypass on a real Production deployment:
 * a synthetic principal returned to every unauthenticated request. The `VERCEL*` checks stay as a
 * second belt precisely because they can vanish without warning.
 *
 * Both harnesses already prove locality to themselves (`scripts/e2e-local.ts` → `assertLocalDbUrl`,
 * `scripts/screenshot-ephemeral.ts` → `assertDbTargetAllowed`), and OPS-1 makes "production with a
 * local `DATABASE_URL`" impossible — so this reuses an invariant the repo already enforces rather
 * than inventing one.
 */
function sessionBypassAllowed(): boolean {
  return (
    !process.env.VERCEL_ENV && !process.env.VERCEL && isLocalDbHost(process.env.DATABASE_URL ?? '')
  );
}

/**
 * 🔴 **Refuse at BOOT, not per request.** A request-time throw lets the mis-wired deployment build
 * green and PROMOTE: it is then live, in DNS, bypass armed, and the failure is found by whoever
 * happens to hit a gated route rather than by the deploy that caused it. A module-import throw is a
 * build-log failure — the `assertDatabaseEnvironment` pattern directly above, for the same reason.
 *
 * Unconditional and outside `SKIP_ENV_VALIDATION`, again matching OPS-1: leaving an auth bypass
 * behind one environment variable would make that variable a silent kill switch for this guard.
 */
/**
 * The bypass principal, decided **once at module scope** and frozen.
 *
 * ⚠️ **One decision, not two.** An earlier shape re-read `process.env` on every call, so the thing
 * that refused at boot and the thing that answered later could disagree if anything mutated the
 * environment mid-process. Taking the snapshot here means the refusal above and the value below are
 * the same evaluation by construction.
 *
 * `lib/dal/session.ts` is the only reader of the accessor, and the only file besides this one
 * allowed to name it — pinned by `apps/web/test/bypass-is-contained.test.ts`.
 */
const BYPASS_PRINCIPAL: string | null = (() => {
  const raw = process.env.E2E_SESSION_BYPASS_USER_ID;
  if (!raw) return null;

  if (!BYPASS_ID_RE.test(raw)) {
    throw new Error(
      'E2E_SESSION_BYPASS_USER_ID is set but is not a Clerk-shaped id. It becomes a rate-limit key ' +
        'and, from 1c-4, a membership lookup — so a malformed one is refused rather than carried. ' +
        'See apps/web/lib/env.ts.',
    );
  }

  if (!sessionBypassAllowed()) {
    throw new Error(
      'E2E_SESSION_BYPASS_USER_ID is set, but this process is not a local throwaway harness ' +
        '(VERCEL/VERCEL_ENV present, or DATABASE_URL is not a local host). It is an authentication ' +
        'bypass and must never arm against a real database. Unset it. See apps/web/lib/env.ts.',
    );
  }

  return raw;
})();

/** The bypass principal, or `null`. See {@link BYPASS_PRINCIPAL}. */
export function sessionBypassUserId(): string | null {
  return BYPASS_PRINCIPAL;
}
