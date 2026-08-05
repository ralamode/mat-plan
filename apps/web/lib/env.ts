import 'server-only';

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Validated environment (V0-4). This is the single place `process.env` is read
 * (per AGENTS.md: no `process.env` outside the DAL / this module). Validation
 * runs at import time, so the server **refuses to boot** on a missing/invalid
 * var rather than failing deep in a request. Add new vars here + `.env.example`.
 *
 * `SKIP_ENV_VALIDATION=1` bypasses validation for tooling that never runs the
 * app (e.g. Docker image builds); real deploys always validate.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Access-gate stopgap shared code — see lib/access-gate.ts. NOT an auth boundary.
    ACCESS_GATE_PASSWORD: z.string().min(8, 'ACCESS_GATE_PASSWORD must be at least 8 characters.'),
    // Pooled Neon string (PgBouncer) for app runtime on the Node runtime. Migrations
    // use the DIRECT/unpooled string via drizzle-kit (tooling), not this app env.
    DATABASE_URL: z.string().url(),

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
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
