import 'server-only';

import { assertDatabaseEnvironment } from '@mat-plan/shared';
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
  },
  client: {},
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    ACCESS_GATE_PASSWORD: process.env.ACCESS_GATE_PASSWORD,
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ALLOW_LIVE_DB: process.env.ALLOW_LIVE_DB,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN,
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
