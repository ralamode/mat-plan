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
  },
  client: {},
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    ACCESS_GATE_PASSWORD: process.env.ACCESS_GATE_PASSWORD,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
